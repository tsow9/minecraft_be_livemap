"""Read-only access to a Minecraft Bedrock world database (Mojang's LevelDB fork) in pure Python."""
import os
import struct
import zlib

TABLE_MAGIC = 0xDB4775248B80FB57
LOG_BLOCK = 32768


def _varint(buf, pos):
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if b < 0x80:
            return result, pos
        shift += 7


def _decompress(raw, kind):
    if kind == 0:
        return raw
    if kind == 2:
        return zlib.decompress(raw)
    if kind == 4:
        return zlib.decompress(raw, -15)
    raise ValueError(f'未対応の圧縮形式です: {kind}')


def _block_entries(block):
    n_restarts = struct.unpack_from('<I', block, len(block) - 4)[0]
    end = len(block) - 4 - 4 * n_restarts
    pos, key = 0, b''
    while pos < end:
        shared, pos = _varint(block, pos)
        non_shared, pos = _varint(block, pos)
        vlen, pos = _varint(block, pos)
        key = key[:shared] + block[pos:pos + non_shared]
        pos += non_shared
        yield key, block[pos:pos + vlen]
        pos += vlen


def _read_table(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) < 48 or struct.unpack_from('<Q', data, len(data) - 8)[0] != TABLE_MAGIC:
        return
    pos = len(data) - 48
    _, pos = _varint(data, pos)
    _, pos = _varint(data, pos)
    idx_off, pos = _varint(data, pos)
    idx_size, pos = _varint(data, pos)

    def read_block(off, size):
        return _decompress(data[off:off + size], data[off + size])

    for _, handle in _block_entries(read_block(idx_off, idx_size)):
        off, p = _varint(handle, 0)
        size, _ = _varint(handle, p)
        for ikey, value in _block_entries(read_block(off, size)):
            tail = struct.unpack_from('<Q', ikey, len(ikey) - 8)[0]
            yield ikey[:-8], tail >> 8, (tail & 0xFF) == 1, value


def _read_log(path):
    with open(path, 'rb') as f:
        data = f.read()
    record, pos = b'', 0
    while pos + 7 <= len(data):
        if LOG_BLOCK - pos % LOG_BLOCK < 7:
            pos += LOG_BLOCK - pos % LOG_BLOCK
            continue
        length, kind = struct.unpack_from('<HB', data, pos + 4)
        chunk = data[pos + 7:pos + 7 + length]
        pos += 7 + length
        if kind == 0 and length == 0:
            continue
        if kind == 1:
            record = chunk
        elif kind == 2:
            record = chunk
            continue
        elif kind == 3:
            record += chunk
            continue
        elif kind == 4:
            record += chunk
        else:
            continue
        yield from _batch(record)
        record = b''


def _batch(rec):
    if len(rec) < 12:
        return
    seq, count = struct.unpack_from('<QI', rec, 0)
    pos = 12
    for i in range(count):
        if pos >= len(rec):
            return
        tag = rec[pos]
        pos += 1
        klen, pos = _varint(rec, pos)
        key = rec[pos:pos + klen]
        pos += klen
        if tag == 1:
            vlen, pos = _varint(rec, pos)
            yield key, seq + i, True, rec[pos:pos + vlen]
            pos += vlen
        else:
            yield key, seq + i, False, None


def _files(db_dir):
    names = sorted(os.listdir(db_dir))
    for name in names:
        full = os.path.join(db_dir, name)
        if name.endswith(('.ldb', '.sst')):
            yield _read_table, full
        elif name.endswith('.log'):
            yield _read_log, full


def scan(db_dir, want=lambda key: True):
    """Yield (key, value) for the newest live version of every key accepted by want()."""
    latest = {}
    for reader, path in _files(db_dir):
        for key, seq, _, _ in reader(path):
            if want(key) and seq > latest.get(key, -1):
                latest[key] = seq
    for reader, path in _files(db_dir):
        for key, seq, alive, value in reader(path):
            if alive and latest.get(key) == seq:
                yield key, value

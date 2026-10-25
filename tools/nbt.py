"""Minimal little-endian NBT reader (the format Bedrock uses on disk)."""
import struct


def read_tag(data, pos, tag):
    if tag == 1:
        return data[pos], pos + 1
    if tag == 2:
        return struct.unpack_from('<h', data, pos)[0], pos + 2
    if tag == 3:
        return struct.unpack_from('<i', data, pos)[0], pos + 4
    if tag == 4:
        return struct.unpack_from('<q', data, pos)[0], pos + 8
    if tag == 5:
        return struct.unpack_from('<f', data, pos)[0], pos + 4
    if tag == 6:
        return struct.unpack_from('<d', data, pos)[0], pos + 8
    if tag == 7:
        n = struct.unpack_from('<i', data, pos)[0]
        return data[pos + 4:pos + 4 + n], pos + 4 + n
    if tag == 8:
        n = struct.unpack_from('<H', data, pos)[0]
        return data[pos + 2:pos + 2 + n].decode('utf-8', 'replace'), pos + 2 + n
    if tag == 9:
        sub, n = data[pos], struct.unpack_from('<i', data, pos + 1)[0]
        pos += 5
        out = []
        for _ in range(n):
            v, pos = read_tag(data, pos, sub)
            out.append(v)
        return out, pos
    if tag == 10:
        out = {}
        while True:
            t = data[pos]
            pos += 1
            if t == 0:
                return out, pos
            n = struct.unpack_from('<H', data, pos)[0]
            name = data[pos + 2:pos + 2 + n].decode('utf-8', 'replace')
            out[name], pos = read_tag(data, pos + 2 + n, t)
    if tag == 11:
        n = struct.unpack_from('<i', data, pos)[0]
        return None, pos + 4 + 4 * n
    if tag == 12:
        n = struct.unpack_from('<i', data, pos)[0]
        return None, pos + 4 + 8 * n
    raise ValueError(f'unknown NBT tag {tag}')


def root_compound(data, pos):
    if data[pos] != 10:
        raise ValueError('palette entry is not a compound')
    n = struct.unpack_from('<H', data, pos + 1)[0]
    return read_tag(data, pos + 3 + n, 10)

"""Faces for the pet marks, made from the game's own models and textures each time the map is built.

The official resource pack (Mojang/bedrock-samples) is fetched with git, and only the files needed are read:
which model and texture an animal uses, which coat each Variant number means, and the cubes of the head.
The head is drawn as seen from straight in front, then made a little brighter and flatter (6 colours, keeping
the eyes, nose and mouth dark). Nothing from the game is kept in this repository; every map build makes the
faces again.
"""
import fnmatch
import io
import json
import math
import os
import re
import subprocess

from PIL import Image

REPO = 'https://github.com/Mojang/bedrock-samples.git'
PACK = 'resource_pack'
BRIGHTER = 0.22   # how far each colour moves towards white
COLOURS = 6       # colours left after flattening
DARK = 100        # pixels darker than this (0-255) keep their own colour: eyes, nose, mouth
# The heads of these include a long neck in one piece: only the top rows are the face.
MAX_ROWS = {'llama': 11, 'trader_llama': 11, 'camel': 9}
# These have their eyes on the sides of the head, out of sight from the front: the head shows one column of each side.
SIDE_EYES = {'horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'parrot'}
NOD = 0.5         # how much of the game's nodding is kept: a horse's neck leans 30 degrees, drawn at 15
DIM = 95          # a coat darker than this (0-255, its middle colour) is lightened up to it
LETTERS = 'abdefghijklmnopqrsuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'  # 'c' (collar) and 't' (tag) are the site's


def _git(repo, *args):
    return subprocess.run(['git', '-C', repo, *args], check=True, capture_output=True).stdout


def fetch(repo):
    """A copy of the official pack with only the small description files checked out; textures are read on demand."""
    if not os.path.isdir(os.path.join(repo, '.git')):
        subprocess.run(['git', 'clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', REPO, repo],
                       check=True, capture_output=True)
        _git(repo, 'sparse-checkout', 'set', f'{PACK}/entity', f'{PACK}/models/entity', f'{PACK}/render_controllers')


def _json(path):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    # A few of the game's files have comments or trailing commas.
    text = re.sub(r'(?m)^\s*//.*$', '', text)
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    return json.loads(text)


def _version(v):
    return tuple(int(p) for p in re.findall(r'\d+', str(v or '0')))


class Pack:
    def __init__(self, repo):
        self.repo = repo
        self.entities, self.geos, self.controllers = {}, {}, {}
        for path in self._files('entity'):
            try:
                d = _json(path)['minecraft:client_entity']['description']
            except (ValueError, KeyError, TypeError):
                continue
            old = self.entities.get(d.get('identifier'))
            if old is None or _version(d.get('min_engine_version')) > _version(old.get('min_engine_version')):
                self.entities[d.get('identifier')] = d
        for path in self._files('models/entity'):
            try:
                self._read_geo(_json(path))
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
        for path in self._files('render_controllers'):
            try:
                self.controllers.update(_json(path).get('render_controllers') or {})
            except (ValueError, AttributeError):
                continue
        self.tree = set(_git(repo, 'ls-tree', '-r', '--name-only', 'HEAD', f'{PACK}/textures/entity').decode().split('\n'))

    def _files(self, sub):
        base = os.path.join(self.repo, PACK, sub)
        return [os.path.join(base, n) for n in sorted(os.listdir(base)) if n.endswith('.json')] if os.path.isdir(base) else []

    def _read_geo(self, d):
        if 'minecraft:geometry' in d:  # format 1.12 and later
            for g in d['minecraft:geometry']:
                desc = g['description']
                self.geos[desc['identifier']] = {'w': desc.get('texture_width', 64), 'h': desc.get('texture_height', 64),
                                                 'bones': g.get('bones') or []}
            return
        pending = {}
        for key, g in d.items():  # format 1.8: "geometry.name" or "geometry.name:geometry.parent"
            if key.startswith('geometry.'):
                name, _, parent = key.partition(':')
                pending[name] = (parent, g)

        def resolve(name, depth=0):
            if name in self.geos or depth > 8:
                return self.geos.get(name)
            parent, g = pending[name]
            base = resolve(parent, depth + 1) if parent in pending else self.geos.get(parent)
            bones = {b['name']: b for b in (base or {}).get('bones', [])}
            for b in g.get('bones') or []:  # a bone of the same name adds its cubes (a sheep's wool round its face)
                old = bones.get(b['name'], {})
                bones[b['name']] = {**old, **b, 'cubes': (old.get('cubes') or []) + (b.get('cubes') or [])}
            self.geos[name] = {'w': g.get('texturewidth', (base or {}).get('w', 64)),
                               'h': g.get('textureheight', (base or {}).get('h', 32)), 'bones': list(bones.values())}
            return self.geos[name]

        for name in pending:
            resolve(name)

    def texture(self, path):
        for ext in ('.png', '.tga'):
            full = f'{PACK}/{path}{ext}'
            if full in self.tree:
                return Image.open(io.BytesIO(_git(self.repo, 'show', f'HEAD:{full}'))).convert('RGBA')
        return None

    def looks(self, kind):
        """(geometry, {variant: texture path}, default texture path, hidden parts) for an animal, or None."""
        d = self.entities.get(f'minecraft:{kind}')
        if not d:
            return None
        geo = self.geos.get((d.get('geometry') or {}).get('default'))
        textures = d.get('textures') or {}
        by_variant, default, hidden = {}, None, []
        for name in d.get('render_controllers') or []:
            name = name if isinstance(name, str) else next(iter(name), '')
            rc = self.controllers.get(name)
            if not rc or not rc.get('textures') or re.search(r'saddle|armor|harness', name):
                continue
            # Parts shown only when saddled, chested, ridden... are left out; so are the ones never shown.
            hidden = [(pat, _molang(val)) for e in rc.get('part_visibility') or [] for pat, val in e.items()]
            expr = str(rc['textures'][0])
            arrays = (rc.get('arrays') or {}).get('textures') or {}
            # The grown-up, untamed, calm coat: the site draws its own collar.
            for name, index in re.findall(r'(Array\.\w+)\[([^\]]+)\]', expr):
                if re.search(r'baby|tame|angry|sleep', name) or name not in arrays:
                    continue
                paths = [textures.get(t.split('.', 1)[1]) for t in arrays[name]]
                default = paths[0]
                if 'variant' in index and 'mark' not in index:
                    by_variant = {i: p for i, p in enumerate(paths) if p}
                break
            else:
                for t in re.findall(r'Texture\.(\w+)', expr):
                    if 'baby' not in t and textures.get(t):
                        default = textures[t]
                        break
            if default:
                break
        return (geo, by_variant, default, hidden) if geo and default else None


def _molang(expr):
    """A part's show-or-hide rule, for a grown-up, awake animal with nothing on (every query is false)."""
    if isinstance(expr, (bool, int, float)):
        return bool(expr)
    text = re.sub(r'\b(query|q|variable|v)\.\w+', ' False ', str(expr))
    text = text.replace('&&', ' and ').replace('||', ' or ').replace('!', ' not ')
    text = re.sub(r'\btrue\b', 'True', re.sub(r'\bfalse\b', 'False', text))
    if not re.fullmatch(r'(\s|\(|\)|True|False|and|or|not)*', text):
        return True
    try:
        return bool(eval(text, {'__builtins__': {}}))  # only True/False/and/or/not/brackets, checked above
    except SyntaxError:
        return True


def _shown(name, hidden):
    shown = True
    for pat, val in hidden:
        if fnmatch.fnmatchcase(name, pat):
            shown = val
    return shown


def _head_cubes(geo, hidden=()):
    """The cubes of the head and of everything hanging from it (ears, snout, horns, beak), each with the
    rotations that place it: its own, its bone's, then each bone above, as in the animal standing still."""
    bones = {b['name']: b for b in geo['bones']}
    head = next((b for b in geo['bones'] if b['name'].lower() == 'head'), None)
    if head is None or not _shown(head['name'], hidden):
        return []

    def chain(bone):
        # Only nodding (a horse's neck leaning forward) is kept. Ears turned outward look like horns from
        # the front, so sideways turns are left out.
        out = []
        while bone is not None:
            if (bone.get('rotation') or [0])[0]:
                out.append(([bone['rotation'][0] * NOD, 0, 0], bone.get('pivot', [0, 0, 0])))
            bone = bones.get(bone.get('parent'))
        return out

    def under_head(bone):
        while bone is not None:
            if bone is head:
                return True
            if not _shown(bone['name'], hidden):
                return False
            bone = bones.get(bone.get('parent'))
        return False

    out = []
    for b in geo['bones']:
        if b.get('neverRender') or not _shown(b['name'], hidden) or not under_head(b):
            continue
        turns = chain(b)
        for c in b.get('cubes') or []:
            own = [([c['rotation'][0] * NOD, 0, 0], c.get('pivot', c['origin']))] if (c.get('rotation') or [0])[0] else []
            out.append({**c, 'mirror': c.get('mirror', b.get('mirror', False)), 'turns': own + turns})
    return out


def _turn(point, turns):
    """A point moved by the rotations (innermost first). The game turns x and y the other way round to maths."""
    x, y, z = point
    for (rx, ry, rz), (px, py, pz) in turns:
        x, y, z = x - px, y - py, z - pz
        a = math.radians(-rx)
        y, z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
        a = math.radians(-ry)
        x, z = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
        a = math.radians(rz)
        x, y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
        x, y, z = x + px, y + py, z + pz
    return x, y, z


def _cut(tex, scale, x, y, w, h):
    """Part of the texture, one pixel per model unit. Any alpha shows: some textures keep a dye mask there."""
    box = (int(round(x * scale)), int(round(y * scale)), int(round((x + w) * scale)), int(round((y + h) * scale)))
    if w <= 0 or h <= 0 or box[2] <= box[0] or box[3] <= box[1]:
        return None
    part = tex.crop(box).resize((max(1, int(round(w))), max(1, int(round(h)))), Image.NEAREST)
    part.putalpha(part.getchannel('A').point(lambda a: 255 if a else 0))
    return part


def _eye_column(face):
    """The column of a side face holding the pixel least like the coat round it (the eye, dark or white)."""
    px = face.load()
    shown = [(x, y) for x in range(face.width) for y in range(face.height) if px[x, y][3]]
    if not shown:
        return face.crop((0, 0, 1, face.height))
    middle = sorted(_lum(px[p]) for p in shown)[len(shown) // 2]
    x = max(shown, key=lambda p: abs(_lum(px[p]) - middle))[0]
    return face.crop((x, 0, x + 1, face.height))


def _faces(cube, tex, scale, side_eyes):
    """The faces that can look forward: (texture, corner of its first pixel, step along a row, step down a column, outward normal)."""
    g = cube.get('inflate', 0)
    x0, y0, z0 = (o - g for o in cube['origin'])
    w, h, d = (n + 2 * g for n in cube['size'])
    x1, y1, z1 = x0 + w, y0 + h, z0 + d
    uv = cube.get('uv', [0, 0])
    out = []
    if isinstance(uv, dict):  # each face placed by hand
        for name, corner, du, dv, normal in (
                ('north', (x0, y1, z0), (w, 0, 0), (0, -h, 0), (0, 0, -1)),
                ('up', (x0, y1, z1), (w, 0, 0), (0, 0, -d), (0, 1, 0))):
            f = uv.get(name)
            if f:
                (u, v), (fw, fh) = f['uv'], f.get('uv_size', [abs(du[0] or du[2]), abs(dv[1] or dv[2])])
                t = _cut(tex, scale, min(u, u + fw), min(v, v + fh), abs(fw), abs(fh))
                if t is not None:
                    if fw < 0:
                        t = t.transpose(Image.FLIP_LEFT_RIGHT)
                    if fh < 0:
                        t = t.transpose(Image.FLIP_TOP_BOTTOM)
                    out.append((t, corner, du, dv, normal))
        return out
    sx, sy, sz = (n for n in cube['size'])
    u, v = uv
    flip = cube['mirror']
    front = _cut(tex, scale, u + sz, v + sz, sx, sy)
    top = _cut(tex, scale, u + sz, v, sx, sz)
    right = _cut(tex, scale, u, v + sz, sz, sy)
    left = _cut(tex, scale, u + sz + sx, v + sz, sz, sy)
    if flip:  # a mirrored cube shows each face the other way round, and swaps its sides
        front, top, right, left = (t.transpose(Image.FLIP_LEFT_RIGHT) if t else None for t in (front, top, left, right))
    for t, corner, du, dv, normal in (
            (front, (x0, y1, z0), (w, 0, 0), (0, -h, 0), (0, 0, -1)),
            (top, (x0, y1, z1), (w, 0, 0), (0, 0, -d), (0, 1, 0)),
            (right, (x0, y1, z1), (0, 0, -d), (0, -h, 0), (-1, 0, 0)),
            (left, (x1, y1, z0), (0, 0, d), (0, -h, 0), (1, 0, 0))):
        if t is not None:
            out.append((t, corner, du, dv, normal))
    if side_eyes and right is not None and left is not None:
        # Eyes on the sides of the head cannot be seen from the front: one column of each side, the one with
        # the eye, stands just outside the front instead.
        out.append((_eye_column(right), (x0 - 1, y1, z0), (1, 0, 0), (0, -h, 0), (0, 0, -1)))
        out.append((_eye_column(left), (x1, y1, z0), (1, 0, 0), (0, -h, 0), (0, 0, -1)))
    return out


def head_image(geo, tex, hidden=(), max_rows=None, side_eyes=False):
    """The head as seen from straight in front, one pixel per model unit."""
    cubes = [c for c in _head_cubes(geo, hidden) if c.get('size') and min(c['size'][:2]) > 0]
    if not cubes:
        return None
    main = max(cubes, key=lambda c: c['size'][0] * c['size'][1])
    scale = tex.width / geo['w']  # a high-resolution texture has more pixels per model unit
    STEPS = (1 / 6, 1 / 2, 5 / 6)  # each texture pixel is looked at in 9 places, so turned faces leave no holes
    points = []  # (x, y, depth, colour)
    for c in cubes:
        for t, corner, du, dv, normal in _faces(c, tex, scale, side_eyes and c is main):
            if _turn(normal, [(r, (0, 0, 0)) for r, _ in c['turns']])[2] > -0.05:  # facing away or edge-on
                continue
            px = t.load()
            for j in range(t.height):
                for i in range(t.width):
                    colour = px[i, j]
                    if not colour[3]:
                        continue
                    for a in STEPS:
                        for b in STEPS:
                            fu, fv = (i + a) / t.width, (j + b) / t.height
                            p = [corner[k] + du[k] * fu + dv[k] * fv for k in range(3)]
                            x, y, z = _turn(p, c['turns'])
                            points.append((x, y, z, colour))
    if not points:
        return None
    # Pixels line up with the corners of the main cube, which need not sit on whole numbers (a head at y = 7.5).
    g = main.get('inflate', 0)
    cx, cy, _ = _turn((main['origin'][0] - g, main['origin'][1] + main['size'][1] + g, main['origin'][2] - g), main['turns'])
    dx, dy = cx - math.floor(cx), cy - math.floor(cy)
    points = [(x - dx, y - dy, z, colour) for x, y, z, colour in points]
    left = math.floor(min(p[0] for p in points))
    top = math.ceil(max(p[1] for p in points))
    width = math.floor(max(p[0] for p in points)) - left + 1
    height = top - math.ceil(min(p[1] for p in points)) + 1
    depth = {}
    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    out = img.load()
    for x, y, z, colour in points:
        col, row = math.floor(x) - left, top - math.ceil(y)
        if 0 <= col < width and 0 <= row < height and z < depth.get((col, row), math.inf):
            depth[col, row] = z  # nearest to the front wins
            out[col, row] = colour[:3] + (255,)
    if max_rows and img.getbbox():
        top_row = img.getbbox()[1]
        img = img.crop((0, top_row, img.width, top_row + max_rows))
    box = img.getbbox()
    return img.crop(box) if box else None


def _lum(p):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


def style(img):
    """Lighter and flatter, but the eyes, nose and mouth stay as dark as they are."""
    w, h = img.size
    px = img.load()
    lit = Image.new('RGB', (w, h))
    out = lit.load()
    shown = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] >= 128]
    if not shown:
        return {}, w, h
    # "Dark" is against the animal's own coat, so a black horse still gets lighter but keeps its eyes.
    middle = sorted(_lum(px[x, y]) for x, y in shown)[len(shown) // 2]
    dark = min(DARK, middle * 0.6)
    lift = max(BRIGHTER, 1 - (255 - DIM) / (255 - middle)) if middle < DIM else BRIGHTER
    for x, y in shown:
        out[x, y] = tuple(int(c + (255 - c) * lift) for c in px[x, y][:3])
    flat = lit.quantize(colors=COLOURS, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB').load()
    return {(x, y): (out[x, y] if _lum(px[x, y]) < dark else flat[x, y]) for x, y in shown}, w, h


def face(img):
    """The site's form: rows of letters ('.' = nothing) and the colour of each letter."""
    pixels, w, h = style(img)
    colours, rows = {}, []
    for y in range(h):
        row = ''
        for x in range(w):
            p = pixels.get((x, y))
            if p is None:
                row += '.'
                continue
            hexc = '#%02x%02x%02x' % p
            if hexc not in colours:
                if len(colours) >= len(LETTERS):
                    hexc = min(colours, key=lambda k: sum((int(k[i:i + 2], 16) - c) ** 2 for i, c in zip((1, 3, 5), p)))
                else:
                    colours[hexc] = LETTERS[len(colours)]
            row += colours[hexc]
        rows.append(row)
    return [rows, {v: k for k, v in colours.items()}]


def build(wanted, repo):
    """Faces for each (kind, variant) wanted: {'kind': face, 'kind:variant': face}."""
    fetch(repo)
    pack = Pack(repo)
    out, cache = {}, {}
    for kind, variant in sorted(wanted, key=lambda kv: (kv[0], -1 if kv[1] is None else kv[1])):
        looks = pack.looks(kind)
        if not looks:
            continue
        geo, by_variant, default, hidden = looks
        for key, path in ((kind, default), (f'{kind}:{variant}', by_variant.get(variant))):
            if not path or key in out:
                continue
            if path not in cache:
                tex = pack.texture(path)
                img = head_image(geo, tex, hidden, MAX_ROWS.get(kind), kind in SIDE_EYES) if tex else None
                cache[path] = face(img) if img else None
            if cache[path]:
                out[key] = cache[path]
    return out

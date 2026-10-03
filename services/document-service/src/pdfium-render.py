"""Private, one-shot renderer. Never logs input, text, paths or native exceptions."""
import sys, os, json, math, time, hashlib, struct, zlib
from contextlib import closing

MIB = 1024 * 1024
JOB = None

def parent_boundary():
    import ctypes as c
    if sys.platform == 'linux':
        parent = os.getppid()
        if c.CDLL(None).prctl(1, 9, 0, 0, 0) != 0 or os.getppid() != parent:
            raise RuntimeError('parent-boundary-unavailable')
    elif sys.platform == 'win32':
        from ctypes import wintypes as w
        import threading
        k = c.WinDLL('kernel32', use_last_error=True)
        k.OpenProcess.restype = w.HANDLE
        k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
        handle = k.OpenProcess(0x00100000, False, os.getppid())
        if not handle: raise RuntimeError('parent-boundary-unavailable')
        def wait():
            k.WaitForSingleObject(handle, 0xffffffff)
            os._exit(1)
        threading.Thread(target=wait, daemon=True).start()

def windows_limit(pid, size):
    import ctypes as c
    from ctypes import wintypes as w
    class Basic(c.Structure):
        _fields_ = [('process_time', c.c_int64), ('job_time', c.c_int64),
                    ('flags', w.DWORD), ('min_ws', c.c_size_t), ('max_ws', c.c_size_t),
                    ('active', w.DWORD), ('affinity', c.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
    class IO(c.Structure):
        _fields_ = [(n, c.c_uint64) for n in ['read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes']]
    class Extended(c.Structure):
        _fields_ = [('basic', Basic), ('io', IO), ('process_memory', c.c_size_t),
                    ('job_memory', c.c_size_t), ('peak_process', c.c_size_t), ('peak_job', c.c_size_t)]
    k = c.WinDLL('kernel32', use_last_error=True)
    k.CreateJobObjectW.restype = w.HANDLE
    k.OpenProcess.restype = w.HANDLE
    k.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
    k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    k.CloseHandle.argtypes = [w.HANDLE]
    job = k.CreateJobObjectW(None, None)
    proc = k.OpenProcess(0x0100 | 0x0001, False, pid)
    info = Extended(); info.basic.flags = 0x2100; info.process_memory = size
    if not job or not proc or not k.SetInformationJobObject(job, 9, c.byref(info), c.sizeof(info)) or not k.AssignProcessToJobObject(job, proc):
        raise RuntimeError('memory-limit-unavailable')
    k.CloseHandle(proc)
    return job  # Keep this handle alive for the entire engine attempt.

def own_limits():
    global JOB
    if sys.platform == 'linux':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512*MIB, 512*MIB))
        resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
        resource.setrlimit(resource.RLIMIT_FSIZE, (24*MIB, 24*MIB))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    elif sys.platform == 'win32':
        JOB = windows_limit(os.getpid(), 384*MIB)
    else:
        raise RuntimeError('memory-limit-unavailable')

def guard(pid):
    global JOB
    if sys.platform == 'linux':
        import resource
        with open('/proc/%d/status' % pid) as f:
            fields = dict(line.split(':', 1) for line in f if ':' in line)
        # V8 reserves virtual address space before this barrier. Bound additional
        # address space, separately cap V8 heap in Node, and monitor total RSS.
        ceiling = int(fields['VmSize'].split()[0])*1024 + 256*MIB
        resource.prlimit(pid, resource.RLIMIT_AS, (ceiling, ceiling))
        resource.prlimit(pid, resource.RLIMIT_CORE, (0, 0))
    elif sys.platform == 'win32':
        JOB = windows_limit(pid, 384*MIB)
    else:
        raise RuntimeError('memory-limit-unavailable')
    print(json.dumps({'ready': True}), flush=True)
    if sys.platform == 'linux':
        while True:
            try:
                with open('/proc/%d/status' % pid) as f:
                    fields = dict(line.split(':', 1) for line in f if ':' in line)
                if int(fields.get('VmRSS', '0 kB').split()[0])*1024 > 320*MIB:
                    print(json.dumps({'limit': True}), flush=True)
                    os.kill(pid, 9)
                    return
            except FileNotFoundError:
                return
            time.sleep(.02)
    else:
        sys.stdin.buffer.read()  # Parent closes/kills the guard after reaping Node.

def runtime():
    import pypdfium2 as pdfium
    import pypdfium2.version as version
    import importlib.metadata
    if str(version.PYPDFIUM_INFO.version) != '5.3.0' or str(version.PDFIUM_INFO.version) != '145.0.7616.0':
        raise RuntimeError('renderer-version-mismatch')
    distribution = importlib.metadata.distribution('pypdfium2')
    notices = sorted(str(p) for p in distribution.files if 'licenses' in p.parts)
    if not all(any(p.endswith(name) for p in notices) for name in ['Apache-2.0.txt', 'BSD-3-Clause.txt', 'BUILD_LICENSES/pdfium.txt']):
        raise RuntimeError('renderer-notices-missing')
    bundle = hashlib.sha256()
    for name in notices:
        bundle.update(name.encode()); bundle.update(distribution.locate_file(name).read_bytes())
    return pdfium, {'engine': 'pdfium', 'binding': '5.3.0', 'version': '145.0.7616.0', 'licenseBundleSha256': bundle.hexdigest()}

def png(bitmap, output):
    # RGB bitmap -> PNG using only the Python standard library; no Pillow pin.
    width, height, stride = bitmap.width, bitmap.height, bitmap.stride
    pixels = memoryview(bitmap.buffer).cast('B')
    compressor = zlib.compressobj(6)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    with open(output, 'xb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)))
        for row in range(height):
            data = compressor.compress(b'\0' + bytes(pixels[row*stride:row*stride+width*3]))
            if data: f.write(chunk(b'IDAT', data))
        f.write(chunk(b'IDAT', compressor.flush()))
        f.write(chunk(b'IEND', b''))

def render(request):
    own_limits()
    pdfium, identity = runtime()
    with open(request, encoding='utf-8') as f: r = json.load(f)
    if os.path.getsize(r['input']) > 250*MIB: raise RuntimeError('source-capacity')
    with open(r['input'], 'rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if digest != r['sourceSha256']: raise RuntimeError('source-integrity-failed')
    with pdfium.PdfDocument(r['input']) as doc:
        doc.init_forms()
        with closing(doc[r['page']-1]) as page:
            width, height = page.get_size()
            if any(not math.isfinite(x) or x <= 0 for x in [width, height]) or width*height > 40000000:
                raise RuntimeError('unsafe-page-size')
            if abs(width-r['width']) > .01 or abs(height-r['height']) > .01 or page.get_rotation() != r['rotation']:
                raise RuntimeError('renderer-geometry-mismatch')
            bbox = list(page.get_bbox())
            if any(abs(a-b) > .01 for a, b in zip(bbox, r['view'])):
                raise RuntimeError('renderer-geometry-mismatch')
            x, y, w, h = [r['region'][k] for k in ['x', 'y', 'width', 'height']]
            scale = r['scale']
            if not all(math.isfinite(v) for v in [x,y,w,h,scale]) or min(x,y) < 0 or min(w,h,scale) <= 0 or x+w > 1.000000001 or y+h > 1.000000001 or scale > 3:
                raise RuntimeError('invalid-crop')
            if math.ceil(width*w*scale)*math.ceil(height*h*scale) > 5000000:
                raise RuntimeError('render-pixel-capacity')
            crop = (x*width, (1-y-h)*height, (1-x-w)*width, y*height)
            pixel_crop = [math.ceil(max(0,v)*scale) for v in crop]
            full_width, full_height = math.ceil(width*scale), math.ceil(height*scale)
            with closing(page.render(scale=scale, crop=tuple(max(0,v) for v in crop), draw_annots=True,
                             may_draw_forms=True, rev_byteorder=True, force_bitmap_format=pdfium.raw.FPDFBitmap_BGR,
                             limit_image_cache=True)) as bitmap:
                if bitmap.width*bitmap.height > 5000000: raise RuntimeError('render-pixel-capacity')
                png(bitmap, r['output'])
                print(json.dumps({'width': bitmap.width, 'height': bitmap.height, 'sourceSha256': digest,
                                  'page': r['page'], 'region': r['region'], 'rotation': page.get_rotation(),
                                  'view': bbox, 'scale': scale,
                                  'pixelTransform': {'fullWidth': full_width, 'fullHeight': full_height,
                                                     'offsetX': pixel_crop[0], 'offsetY': pixel_crop[3]}, **identity}), flush=True)

try:
    parent_boundary()
    if sys.argv[1] == '--guard': guard(int(sys.argv[2]))
    elif sys.argv[1] == '--probe':
        own_limits(); pdfium, identity = runtime()
        with pdfium.PdfDocument.new() as doc:
            with closing(doc.new_page(10,10)) as page:
                with closing(page.render(scale=1, draw_annots=True)) as bitmap:
                    if bitmap.width != 10: raise RuntimeError('renderer-probe-failed')
        print(json.dumps(identity), flush=True)
    else: render(sys.argv[1])
except BaseException as error:
    allowed = {'renderer-version-mismatch', 'renderer-notices-missing', 'source-integrity-failed',
               'renderer-geometry-mismatch', 'unsafe-page-size', 'invalid-crop', 'source-capacity', 'render-pixel-capacity'}
    code = str(error) if isinstance(error, RuntimeError) and str(error) in allowed else 'renderer-process-failed'
    print(json.dumps({'error': code}), flush=True)
    sys.exit(1)

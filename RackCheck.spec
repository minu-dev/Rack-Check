

a = Analysis(
    ['Source.py'],
    pathex=[],
    binaries=[],
    datas=[('ui/*.html', 'ui'), ('ui/*.css', 'ui'), ('ui/*.js', 'ui'), ('app.ico', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['customtkinter'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

# Splash screen shown at exe launch
# exe 실행 직후 시작 화면
splash = Splash(
    'splash.png',
    binaries=a.binaries,
    datas=a.datas,
    text_pos=None,
    always_on_top=False,
)

exe = EXE(
    pyz,
    a.scripts,
    splash,
    splash.binaries,
    a.binaries,
    a.datas,
    [],
    name='RackCheck',
    icon='app.ico',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

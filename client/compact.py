"""compact.py — Launch opencode TUI in Windows Terminal, send /compact via SendInput."""

import sys
import json
import time
import os
import ctypes
import ctypes.wintypes
import subprocess
import argparse

# ── SendInput helpers (hardware-level keyboard simulation, like DeskBeam) ──
u32 = ctypes.WinDLL("user32", use_last_error=True)
k32 = ctypes.WinDLL("kernel32", use_last_error=True)

INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_SCANCODE = 0x0008
VK_RETURN = 0x0D
VK_SHIFT = 0x10


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.wintypes.LONG),
        ("dy", ctypes.wintypes.LONG),
        ("mouseData", ctypes.wintypes.DWORD),
        ("dwFlags", ctypes.wintypes.DWORD),
        ("time", ctypes.wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.wintypes.WORD),
        ("wScan", ctypes.wintypes.WORD),
        ("dwFlags", ctypes.wintypes.DWORD),
        ("time", ctypes.wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", ctypes.wintypes.DWORD),
        ("wParamL", ctypes.wintypes.WORD),
        ("wParamH", ctypes.wintypes.WORD),
    ]


class INPUT_U(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.wintypes.DWORD), ("_input", INPUT_U)]


u32.SendInput.argtypes = [ctypes.wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
u32.SendInput.restype = ctypes.wintypes.UINT


def _send_unicode(ch):
    scan = ord(ch)
    down = INPUT(INPUT_KEYBOARD, INPUT_U(ki=KEYBDINPUT(0, scan, KEYEVENTF_UNICODE, 0, None)))
    up = INPUT(INPUT_KEYBOARD, INPUT_U(ki=KEYBDINPUT(0, scan, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, None)))
    arr = (INPUT * 2)(down, up)
    u32.SendInput(2, arr, ctypes.sizeof(INPUT))


def _send_enter():
    down = INPUT(INPUT_KEYBOARD, INPUT_U(ki=KEYBDINPUT(VK_RETURN, 0, 0, 0, None)))
    up = INPUT(INPUT_KEYBOARD, INPUT_U(ki=KEYBDINPUT(VK_RETURN, 0, KEYEVENTF_KEYUP, 0, None)))
    arr = (INPUT * 2)(down, up)
    u32.SendInput(2, arr, ctypes.sizeof(INPUT))


def _send_vk(vk, up=False):
    flags = KEYEVENTF_KEYUP if up else 0
    inp = INPUT(INPUT_KEYBOARD, INPUT_U(ki=KEYBDINPUT(vk, 0, flags, 0, None)))
    u32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def type_text(text):
    for ch in text:
        _send_unicode(ch)
        time.sleep(0.01)


GW_OWNER = 4
CASCADIA_CLASS = "CASCADIA_HOSTING_WINDOW_CLASS"


def _force_focus(hwnd):
    """Force foreground via AttachThreadInput + BringWindowToTop + SetForegroundWindow.

    From a background (windowless) thread SetForegroundWindow is blocked by the
    foreground lock, so we first simulate an Alt keypress to unlock it.
    """
    VK_MENU = 0x12
    _send_vk(VK_MENU)
    _send_vk(VK_MENU, up=True)
    time.sleep(0.05)

    fg = u32.GetForegroundWindow()
    fg_tid = u32.GetWindowThreadProcessId(fg, None)
    my_tid = k32.GetCurrentThreadId()
    attached = False
    if fg_tid != my_tid:
        attached = u32.AttachThreadInput(my_tid, fg_tid, True)
    u32.BringWindowToTop(hwnd)
    u32.ShowWindow(hwnd, 9)
    ok = u32.SetForegroundWindow(hwnd)
    u32.SetFocus(hwnd)
    u32.SetActiveWindow(hwnd)
    if attached:
        u32.AttachThreadInput(my_tid, fg_tid, False)
    return ok


def _cascadia_windows():
    """Return set of current visible CASCADIA top-level window handles."""
    result = set()

    @ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    def cb(hwnd, _):
        if u32.GetWindow(hwnd, GW_OWNER):
            return True
        if not u32.IsWindowVisible(hwnd):
            return True
        buf = ctypes.create_unicode_buffer(64)
        u32.GetClassNameW(hwnd, buf, 64)
        if CASCADIA_CLASS in buf.value:
            result.add(hwnd)
        return True

    u32.EnumWindows(cb, 0)
    return result


def _focus_wt(before, timeout=30):
    """Wait for a NEW CASCADIA window (created since `before` snapshot) and focus it.

    Returns (hwnd, focused). hwnd is None only if no new window ever appeared
    (opencode really didn't start). focused is False if the window exists but we
    could not grab the foreground — the caller may still proceed since the new
    window usually has focus on its own.
    """
    deadline = time.time() + timeout
    found = None
    while time.time() < deadline:
        now = _cascadia_windows()
        new = now - before
        if new:
            for hwnd in new:
                if found is None:
                    found = hwnd
                _force_focus(hwnd)
                time.sleep(0.2)
                if u32.GetForegroundWindow() == hwnd:
                    return hwnd, True
        time.sleep(0.5)
    return found, False


def _launch_wt(wt, wt_args, env):
    """Launch wt.exe. Returns the launched process pid, or None on failure."""
    try:
        p = subprocess.Popen([wt] + wt_args, env=env, creationflags=0)
        return p.pid
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--mode", choices=["win", "wsl"], required=True)
    parser.add_argument("--opencode", default="opencode")
    parser.add_argument("--startup-wait", type=int, default=20)
    parser.add_argument("--compact-wait", type=int, default=90)
    parser.add_argument("--wt", default=os.environ.get("WT_EXE") or os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe"))
    args = parser.parse_args()

    stdout_fd = os.dup(1)
    def out(obj):
        os.write(stdout_fd, (json.dumps(obj) + "\n").encode())

    env = dict(os.environ)
    env["TERM"] = "xterm-256color"

    try:
        if args.mode == "wsl":
            cmd = f'cd "{args.dir}" && {args.opencode} -s {args.session}'
            wt_args = ["-w", "new", "new-tab", "--title", "VibeCoding Compact",
                       "wsl.exe", "bash", "-lc", cmd]
        else:
            cmd = f'cd /d "{args.dir}" && {args.opencode} -s {args.session}'
            wt_args = ["-w", "new", "new-tab", "--title", "VibeCoding Compact",
                       "cmd.exe", "/k", cmd]

        before = _cascadia_windows()
        wt_pid = _launch_wt(args.wt, wt_args, env)
        if not wt_pid:
            out({"success": False, "message": "Failed to launch wt.exe"})
            return

        time.sleep(args.startup_wait)

        hwnd, focused = _focus_wt(before, timeout=args.startup_wait)
        if not hwnd:
            out({"success": False, "message": "opencode terminal window not found"})
            return
        if not focused:
            _force_focus(hwnd)
            time.sleep(0.5)

        def refocus():
            _force_focus(hwnd)
            time.sleep(0.3)

        refocus()
        type_text("/compact")
        _send_enter()
        time.sleep(args.compact_wait)

        refocus()
        type_text("/exit")
        _send_enter()
        time.sleep(3)

        refocus()
        type_text("exit")
        _send_enter()
        time.sleep(2)

        out({"success": True, "message": "Compact completed"})

    except Exception as e:
        out({"success": False, "message": str(e)})


if __name__ == "__main__":
    main()

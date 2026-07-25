"""compact.py — AllocConsole, launch shell, send /compact via WriteConsoleInput."""

import sys
import json
import time
import os
import ctypes
import ctypes.wintypes
import subprocess
import argparse

k32 = ctypes.WinDLL("kernel32", use_last_error=True)

STD_INPUT_HANDLE = -10
STD_OUTPUT_HANDLE = -11
KEY_EVENT = 1
VK_RETURN = 0x0D


class SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ("nLength", ctypes.wintypes.DWORD),
        ("lpSecurityDescriptor", ctypes.wintypes.LPVOID),
        ("bInheritHandle", ctypes.wintypes.BOOL),
    ]


class KeyEventRecord(ctypes.Structure):
    _fields_ = [
        ("bKeyDown", ctypes.wintypes.BOOL),
        ("wRepeatCount", ctypes.wintypes.WORD),
        ("wVirtualKeyCode", ctypes.wintypes.WORD),
        ("wVirtualScanCode", ctypes.wintypes.WORD),
        ("uChar", ctypes.wintypes.WCHAR),
        ("dwControlKeyState", ctypes.wintypes.DWORD),
    ]


class InputRecord(ctypes.Structure):
    _fields_ = [
        ("EventType", ctypes.wintypes.WORD),
        ("Event", KeyEventRecord),
    ]


k32.AllocConsole.argtypes = []
k32.AllocConsole.restype = ctypes.wintypes.BOOL
k32.FreeConsole.argtypes = []
k32.FreeConsole.restype = ctypes.wintypes.BOOL
k32.SetConsoleTitleW.argtypes = [ctypes.wintypes.LPCWSTR]
k32.SetConsoleTitleW.restype = ctypes.wintypes.BOOL
k32.SetStdHandle.argtypes = [ctypes.wintypes.DWORD, ctypes.wintypes.HANDLE]
k32.SetStdHandle.restype = ctypes.wintypes.BOOL
k32.WriteConsoleInputW.argtypes = [
    ctypes.wintypes.HANDLE, ctypes.c_void_p, ctypes.wintypes.DWORD,
    ctypes.POINTER(ctypes.wintypes.DWORD),
]
k32.WriteConsoleInputW.restype = ctypes.wintypes.BOOL
k32.CreateFileW.argtypes = [
    ctypes.wintypes.LPCWSTR, ctypes.wintypes.DWORD, ctypes.wintypes.DWORD,
    ctypes.POINTER(SECURITY_ATTRIBUTES), ctypes.wintypes.DWORD,
    ctypes.wintypes.DWORD, ctypes.wintypes.HANDLE,
]
k32.CreateFileW.restype = ctypes.wintypes.HANDLE


def make_sa():
    sa = SECURITY_ATTRIBUTES()
    sa.nLength = ctypes.sizeof(SECURITY_ATTRIBUTES)
    sa.bInheritHandle = True
    sa.lpSecurityDescriptor = None
    return sa


def con_open(name, access, share):
    sa = make_sa()
    return k32.CreateFileW(name, access, share, ctypes.byref(sa), 3, 0, None)


def write_text(h_stdin, text, press_enter=True):
    records = []
    for ch in text:
        records.append(InputRecord(KEY_EVENT, KeyEventRecord(True, 1, 0, 0, ch, 0)))
        records.append(InputRecord(KEY_EVENT, KeyEventRecord(False, 1, 0, 0, ch, 0)))
    arr = (InputRecord * len(records))(*records)
    written = ctypes.wintypes.DWORD()
    ok = k32.WriteConsoleInputW(h_stdin, arr, len(records), ctypes.byref(written))
    if not (bool(ok) and written.value == len(records)):
        return False
    if press_enter:
        time.sleep(0.15)
        _send_enter(h_stdin)
    return True


def _send_enter(h_stdin):
    """Send Enter via SendInput (hardware-level simulation)."""
    u32 = ctypes.WinDLL("user32", use_last_error=True)
    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 2

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", ctypes.wintypes.WORD),
            ("wScan", ctypes.wintypes.WORD),
            ("dwFlags", ctypes.wintypes.DWORD),
            ("time", ctypes.wintypes.DWORD),
            ("dwExtraInfo", ctypes.c_void_p),
        ]

    class INPUT_U(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ("type", ctypes.wintypes.DWORD),
            ("u", INPUT_U),
        ]

    inp = (INPUT * 2)(
        INPUT(INPUT_KEYBOARD, INPUT_U(KEYBDINPUT(VK_RETURN, 0, 0, 0, None))),
        INPUT(INPUT_KEYBOARD, INPUT_U(KEYBDINPUT(VK_RETURN, 0, KEYEVENTF_KEYUP, 0, None))),
    )
    u32.SendInput(2, inp, ctypes.sizeof(INPUT))

    # Also write VK_RETURN via WriteConsoleInput for readers that use ReadConsoleInputW
    ir = (InputRecord * 2)(
        InputRecord(KEY_EVENT, KeyEventRecord(True, 1, VK_RETURN, 0, '\r', 0)),
        InputRecord(KEY_EVENT, KeyEventRecord(False, 1, VK_RETURN, 0, '\r', 0)),
    )
    written = ctypes.wintypes.DWORD()
    k32.WriteConsoleInputW(h_stdin, ir, 2, ctypes.byref(written))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--mode", choices=["win", "wsl"], required=True)
    parser.add_argument("--opencode", default="opencode")
    parser.add_argument("--startup-wait", type=int, default=20)
    parser.add_argument("--compact-wait", type=int, default=45)
    args = parser.parse_args()

    stdout_fd = os.dup(1)
    def out(obj):
        os.write(stdout_fd, (json.dumps(obj) + "\n").encode())

    try:
        k32.FreeConsole()
        if not k32.AllocConsole():
            raise RuntimeError("AllocConsole failed")
        k32.SetConsoleTitleW("VibeCoding Compact")

        h_stdin = con_open("CONIN$", 0x80000000 | 0x40000000, 3)
        h_stdout = con_open("CONOUT$", 0x40000000, 2)
        INVALID = ctypes.c_void_p(-1).value
        if h_stdin == INVALID or h_stdout == INVALID:
            raise RuntimeError("CreateFile CON handle failed")

        k32.SetStdHandle(STD_INPUT_HANDLE, h_stdin)
        k32.SetStdHandle(STD_OUTPUT_HANDLE, h_stdout)
        k32.SetStdHandle(-12, h_stdout)

        time.sleep(0.5)

        subprocess.Popen(
            ["powershell.exe", "-NoLogo", "-NoExit"],
            creationflags=0,
        )

        time.sleep(3)
        write_text(h_stdin, f'cd "{args.dir}"')
        time.sleep(1)
        write_text(h_stdin, f'{args.opencode} -s {args.session}')
        time.sleep(args.startup_wait)

        write_text(h_stdin, "/compact")
        time.sleep(args.compact_wait)

        write_text(h_stdin, "/exit")
        time.sleep(5)

        if args.mode == "wsl":
            write_text(h_stdin, "exit")
            time.sleep(2)
        write_text(h_stdin, "exit")
        time.sleep(3)

        out({"success": True, "message": "Compact completed"})

    except Exception as e:
        out({"success": False, "message": str(e)})


if __name__ == "__main__":
    main()

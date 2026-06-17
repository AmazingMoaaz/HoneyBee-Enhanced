//go:build windows

package clog

import (
	"syscall"
	"unsafe"
)

// enableVT turns on ENABLE_VIRTUAL_TERMINAL_PROCESSING on the stdout console so
// ANSI color escapes render instead of printing literally. Best-effort: any
// failure is ignored (older consoles simply won't get color).
func enableVT() {
	const (
		stdOutputHandle                = ^uint32(10) // (DWORD)-11
		enableVirtualTerminalProcessng = 0x0004
	)
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getStdHandle := kernel32.NewProc("GetStdHandle")
	getConsoleMode := kernel32.NewProc("GetConsoleMode")
	setConsoleMode := kernel32.NewProc("SetConsoleMode")

	handle, _, _ := getStdHandle.Call(uintptr(stdOutputHandle))
	if handle == 0 || handle == uintptr(^uintptr(0)) {
		return
	}
	var mode uint32
	if r, _, _ := getConsoleMode.Call(handle, uintptr(unsafe.Pointer(&mode))); r == 0 {
		return
	}
	setConsoleMode.Call(handle, uintptr(mode|enableVirtualTerminalProcessng))
}

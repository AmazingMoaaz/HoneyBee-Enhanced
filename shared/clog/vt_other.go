//go:build !windows

package clog

// enableVT is a no-op on non-Windows platforms, where terminals already
// interpret ANSI escape sequences.
func enableVT() {}

//go:build darwin || linux

package main

import (
	"os/exec"
	"syscall"
)

// processGroupsSupported reports whether this build can contain an executor and
// its descendants in one signallable group.
const processGroupsSupported = true

// useProcessGroup puts the executor in a new group so shutdown reaches every
// descendant, not just the child the watcher started.
func useProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// signalProcessGroup delivers a signal to the whole group.
func signalProcessGroup(processGroupID int, signal syscall.Signal) error {
	if processGroupID <= 0 {
		return nil
	}
	return syscall.Kill(-processGroupID, signal)
}

// processGroupAlive reports whether any process in the group still exists.
func processGroupAlive(processGroupID int) bool {
	if processGroupID <= 0 {
		return false
	}
	return syscall.Kill(-processGroupID, 0) == nil
}

// processAlive reports whether one process still exists, which is how a run
// still being launched is told from one a crashed watcher left behind.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

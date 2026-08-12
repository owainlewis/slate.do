//go:build !darwin && !linux

package main

import (
	"errors"
	"os/exec"
	"syscall"
)

// This build cannot contain an executor's descendants, so the watcher refuses
// to start rather than leaving processes it cannot stop.
const processGroupsSupported = false

func useProcessGroup(command *exec.Cmd) {}

func signalProcessGroup(processGroupID int, signal syscall.Signal) error {
	return errors.New("process groups are supported on macOS and Linux only")
}

func processGroupAlive(processGroupID int) bool { return false }

func processAlive(pid int) bool { return false }

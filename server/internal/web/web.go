package web

import (
	"embed"
	"io/fs"
	"os"
)

//go:embed dist/*
var embedded embed.FS

func FileSystem(staticDir string) (fs.FS, error) {
	if staticDir != "" {
		return os.DirFS(staticDir), nil
	}
	return fs.Sub(embedded, "dist")
}

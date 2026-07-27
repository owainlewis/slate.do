package server

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

func StaticHandler(content fs.FS) http.Handler {
	files := http.FileServer(http.FS(content))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		clean := path.Clean(r.URL.Path)
		name := strings.TrimPrefix(clean, "/")
		if name == "." || name == "" {
			name = "index.html"
		}
		if ok, err := exists(content, name); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		} else if ok {
			if path.Ext(name) == ".html" {
				serveFile(w, r, content, name)
				return
			}
			files.ServeHTTP(w, r)
			return
		}
		if path.Ext(name) == "" {
			htmlName := name + ".html"
			if ok, err := exists(content, htmlName); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			} else if ok {
				serveFile(w, r, content, htmlName)
				return
			}
		}
		if path.Ext(name) != "" || !isAppRoute(clean) {
			http.NotFound(w, r)
			return
		}
		serveFile(w, r, content, "index.html")
	})
}

// isAppRoute reports whether a path is a frontend route that must boot the
// single-page app. Anything else is a genuine 404 rather than an empty shell.
// These shapes mirror parseRoute in web/dist/app.js; keep the two in step.
func isAppRoute(clean string) bool {
	switch clean {
	case "/", "/login", "/app", "/app/settings", "/early-access", "/reset-password":
		return true
	}
	// A board id is one non-empty path segment. Whether it names a board the
	// caller can see is the app's decision, not the file server's.
	id, ok := strings.CutPrefix(clean, "/app/boards/")
	return ok && id != "" && !strings.Contains(id, "/")
}

func exists(content fs.FS, name string) (bool, error) {
	file, err := content.Open(name)
	if err == nil {
		_ = file.Close()
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func serveFile(w http.ResponseWriter, r *http.Request, content fs.FS, name string) {
	body, err := fs.ReadFile(content, name)
	if err != nil {
		http.Error(w, "static frontend has not been built", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}

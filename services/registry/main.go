package main

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

func main() {
	ctx := context.Background()
	databaseURL := getDatabaseURL()
	port := os.Getenv("HTTP_PORT")
	if port == "" {
		port = "8080"
	}

	store, err := NewStore(ctx, databaseURL)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer store.Close()

	safeMode := strings.TrimSpace(os.Getenv("AMP_SAFE_MODE")) == "1"
	writeToken := strings.TrimSpace(os.Getenv("REGISTRY_WRITE_TOKEN"))

	if safeMode && writeToken == "" {
		log.Fatalf("FATAL: AMP_SAFE_MODE=1 requires REGISTRY_WRITE_TOKEN to be set. " +
			"Generate one with: openssl rand -base64 32")
	}
	if writeToken == "" {
		log.Println("WARNING: REGISTRY_WRITE_TOKEN not set — write endpoints are open (dev/local mode). " +
			"Set REGISTRY_WRITE_TOKEN or AMP_SAFE_MODE=1 before exposing this registry publicly.")
	} else {
		log.Println("registry write auth: enabled (REGISTRY_WRITE_TOKEN)")
	}

	srv := NewServer(store, writeToken)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", srv.Health)
	mux.HandleFunc("POST /agents", srv.Register)
	mux.HandleFunc("GET /agents", srv.List)
	mux.HandleFunc("GET /agents/{id}", srv.Get)
	mux.HandleFunc("PATCH /agents/{id}/status", srv.UpdateStatus)
	mux.HandleFunc("PUT /agents/{id}/status", srv.UpdateStatus)
	mux.HandleFunc("DELETE /agents/{id}", srv.Delete)

	addr := ":" + port
	httpSrv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		log.Printf("registry listening on %s", addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// getDatabaseURL returns the DB connection string. If DATABASE_URL is set, use it.
// Otherwise build from DATABASE_USER, DATABASE_PASSWORD, DATABASE_HOST, etc., so the
// password is URL-encoded and special characters work.
func getDatabaseURL() string {
	if u := os.Getenv("DATABASE_URL"); u != "" {
		return u
	}
	user := os.Getenv("DATABASE_USER")
	password := os.Getenv("DATABASE_PASSWORD")
	host := os.Getenv("DATABASE_HOST")
	dbname := os.Getenv("DATABASE_NAME")
	if user == "" {
		user = "amp"
	}
	if host == "" {
		host = "localhost"
	}
	if dbname == "" {
		dbname = "amp_registry"
	}
	port := os.Getenv("DATABASE_PORT")
	if port == "" {
		port = "5432"
	}
	sslMode := os.Getenv("DATABASE_SSLMODE")
	if sslMode == "" {
		sslMode = "disable"
	}
	// URL-encode user and password so special characters work
	userInfo := url.UserPassword(user, password)
	u := &url.URL{
		Scheme:   "postgres",
		User:     userInfo,
		Host:     host + ":" + port,
		Path:     "/" + dbname,
		RawQuery: "sslmode=" + url.QueryEscape(sslMode),
	}
	return u.String()
}

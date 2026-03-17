package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx := context.Background()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://amp:amp@localhost:5432/amp_registry?sslmode=disable"
	}
	port := os.Getenv("HTTP_PORT")
	if port == "" {
		port = "8080"
	}

	store, err := NewStore(ctx, databaseURL)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer store.Close()

	srv := NewServer(store)
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

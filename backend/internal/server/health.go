package server

import "net/http"

func HealthRoute() Route {
	return Route{
		Pattern: "/healthz",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		}),
	}
}

import React from "react"
import ReactDOM from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter } from "react-router-dom"
import { Tooltip } from "radix-ui"
import App from "./App"
import "./styles.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={350}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Tooltip.Provider>
    </QueryClientProvider>
  </React.StrictMode>,
)

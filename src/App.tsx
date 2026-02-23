import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";
import EarningsTracker from "./pages/EarningsTracker";
import Calculator from "./pages/Calculator";
import Performance from "./pages/Performance";
import NotFound from "./pages/NotFound";
import TestImport from "./pages/TestImport";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/earnings" element={<EarningsTracker />} />
            <Route path="/calculator" element={<Calculator />} />
          </Route>
          <Route path="/test-import" element={<TestImport />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

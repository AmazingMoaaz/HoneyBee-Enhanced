import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./stores/auth";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import NodesPage from "./pages/NodesPage";
import NodeDetailPage from "./pages/NodeDetailPage";
import DeploymentsPage from "./pages/DeploymentsPage";
import EventsPage from "./pages/EventsPage";
import SessionsPage from "./pages/SessionsPage";
import ReplayPage from "./pages/ReplayPage";
import PotStorePage from "./pages/PotStorePage";
import UsersPage from "./pages/UsersPage";
import Layout from "./components/Layout";

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.accessToken);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/nodes/:id" element={<NodeDetailPage />} />
        <Route path="/deployments" element={<DeploymentsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id/replay" element={<ReplayPage />} />
        <Route path="/potstore" element={<PotStorePage />} />
        <Route path="/users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

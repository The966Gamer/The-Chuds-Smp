import React from "react";
import { api, setCsrfToken } from "./lib/client/api";
import LoginView from "./views/LoginView";
import SetupWizardView from "./views/SetupWizardView";
import PanelShell, { type NavItem } from "./views/PanelShell";
import DashboardView from "./views/DashboardView";
import ConsoleView from "./views/ConsoleView";
import PlayersView from "./views/PlayersView";
import GravesView from "./views/GravesView";
import ChatView from "./views/ChatView";
import ActivityView from "./views/ActivityView";
import StatisticsView from "./views/StatisticsView";
import DiscordView from "./views/DiscordView";
import SettingsView from "./views/SettingsView";

export default function App() {
  const [currentUser, setCurrentUser] = React.useState<{ username: string; role: string } | null>(null);
  const [activeTab, setActiveTab] = React.useState<NavItem>("dashboard");
  const [showSetup, setShowSetup] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // Check auth status
    api
      .get<{ user: { username: string; role: string }; csrfToken: string }>("/api/auth/me")
      .then((res) => {
        setCsrfToken(res.csrfToken);
        setCurrentUser(res.user);
      })
      .catch(() => {
        // Not authenticated
        setCurrentUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleLogout = React.useCallback(() => {
    setCurrentUser(null);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (showSetup) {
    return (
      <SetupWizardView
        onDone={() => {
          setShowSetup(false);
        }}
      />
    );
  }

  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={(user) => {
          setCurrentUser(user);
        }}
        onOpenSetup={() => {
          setShowSetup(true);
        }}
      />
    );
  }

  return (
    <PanelShell
      initialUser={currentUser}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab)}
      onLogout={handleLogout}
    >
      {activeTab === "dashboard" && <DashboardView user={currentUser} />}
      {activeTab === "console" && <ConsoleView />}
      {activeTab === "players" && <PlayersView />}
      {activeTab === "graves" && <GravesView />}
      {activeTab === "chat" && <ChatView />}
      {activeTab === "activity" && <ActivityView />}
      {activeTab === "statistics" && <StatisticsView />}
      {activeTab === "discord" && <DiscordView />}
      {activeTab === "settings" && <SettingsView user={currentUser} onLogout={() => setCurrentUser(null)} />}
    </PanelShell>
  );
}

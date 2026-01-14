import { HubsList } from "../components/HubsList";

export default function HomePage() {
  return (
    <main className="page grid" style={{ gap: "24px" }}>
      <header className="grid card">
        <h1 style={{ margin: 0 }}>Caddie</h1>
        <p className="muted">
          Upload your onboarding docs, process them into embeddings, and chat with cited answers. Start by creating a hub,
          then upload a file and ask a question.
        </p>
      </header>
      <HubsList />
    </main>
  );
}

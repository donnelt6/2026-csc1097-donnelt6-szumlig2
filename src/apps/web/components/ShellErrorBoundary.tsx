'use client';

import Link from "next/link";
import React from "react";

interface ShellErrorBoundaryProps {
  children: React.ReactNode;
}

interface ShellErrorBoundaryState {
  hasError: boolean;
}

export class ShellErrorBoundary extends React.Component<ShellErrorBoundaryProps, ShellErrorBoundaryState> {
  state: ShellErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ShellErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("ui.shell_boundary.error", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="page">
        <div className="card grid" style={{ gap: "16px" }}>
          <h1 style={{ margin: 0 }}>Something went wrong</h1>
          <p className="muted">A part of the app failed unexpectedly. You can retry here or return to a safe page.</p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button className="button" type="button" onClick={this.handleRetry}>
              Retry
            </button>
            <Link href="/" className="button button--secondary">
              Home
            </Link>
            <Link href="/auth" className="button button--secondary">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }
}

import { Component, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '#/components/ui/button';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-title">页面出错了</div>
        <div className="crash-text">{this.state.error.message}</div>
        <Button variant="default" size="sm" onClick={() => location.reload()}><RotateCcw size={12} />重新加载</Button>
      </div>
    );
  }
}

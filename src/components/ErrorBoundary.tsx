import { Component, ErrorInfo, ReactNode } from 'react'
import { t } from '../i18n'

interface State { error: Error | null }

/**
 * Fängt Darstellungsfehler ab, damit nicht die ganze App weiß wird.
 * Bietet einen Notfall-Export der lokal gespeicherten Daten an.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Darstellungsfehler:', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Beim Seitenwechsel neu versuchen
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  private exportRaw = () => {
    let raw = '{}'
    try { raw = localStorage.getItem('12wm-db-v1') || '{}' } catch { /* ignore */ }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    a.download = `12-week-mastery-notfall-export-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card crash">
        <h2>{t('Hier ist etwas schiefgelaufen.')}</h2>
        <p className="muted">{t('Deine Daten sind nicht verloren – sie liegen weiterhin in diesem Browser (und, falls angemeldet, auf dem Server).')}</p>
        <pre className="crash-msg">{this.state.error.message}</pre>
        <div className="toolbar">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>{t('Erneut versuchen')}</button>
          <button className="btn" onClick={() => { location.href = '/' }}>{t('Zur Startseite')}</button>
          <button className="btn" onClick={this.exportRaw}>{t('Daten exportieren')}</button>
        </div>
      </div>
    )
  }
}

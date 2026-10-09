import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import { useSimulation } from './hooks/useSimulation'

// New dashboard pages
import Overview      from './pages/Overview'
import LiveControl   from './pages/LiveControl'
import Analytics     from './pages/Analytics'
import Sensors       from './pages/Sensors'
import Services      from './pages/Services'
import Events        from './pages/Events'
import Simulation    from './pages/Simulation'
import Settings      from './pages/Settings'

// Preserved legacy pages (keep working — they use existing APIs)
import Dashboard     from './pages/Dashboard'
import LiveMonitoring from './pages/LiveMonitoring'
import PanelControl  from './pages/PanelControl'
import MLModel       from './pages/MLModel'
import Comparison    from './pages/Comparison'
import CostAnalysis  from './pages/CostAnalysis'
import SystemOverview from './pages/SystemOverview'
import HardwareStatus from './pages/HardwareStatus'
import AlgorithmsGuide from './pages/AlgorithmsGuide'

export default function App() {
  const { snapshot, connected } = useSimulation()

  return (
    <Layout snapshot={snapshot} wsConnected={connected}>
      <Routes>
        {/* New simulation-first pages */}
        <Route path="/"            element={<Overview snapshot={snapshot} />} />
        <Route path="/live-control" element={<LiveControl snapshot={snapshot} />} />
        <Route path="/analytics"   element={<Analytics />} />
        <Route path="/sensors"     element={<Sensors snapshot={snapshot} />} />
        <Route path="/services"    element={<Services snapshot={snapshot} />} />
        <Route path="/events"      element={<Events />} />
        <Route path="/simulation"  element={<Simulation snapshot={snapshot} />} />
        <Route path="/settings"    element={<Settings />} />

        {/* Legacy pages — preserved intact */}
        <Route path="/legacy/dashboard"  element={<Dashboard />} />
        <Route path="/legacy/monitoring" element={<LiveMonitoring />} />
        <Route path="/legacy/control"    element={<PanelControl />} />
        <Route path="/legacy/ml"         element={<MLModel />} />
        <Route path="/legacy/comparison" element={<Comparison />} />
        <Route path="/legacy/cost"       element={<CostAnalysis />} />
        <Route path="/legacy/overview"   element={<SystemOverview />} />
        <Route path="/legacy/hardware"   element={<HardwareStatus />} />
        <Route path="/legacy/algorithms" element={<AlgorithmsGuide />} />

        {/* Redirect old routes to new */}
        <Route path="/control"    element={<Navigate to="/live-control" replace />} />
        <Route path="/monitoring" element={<Navigate to="/analytics" replace />} />
        <Route path="/overview"   element={<Navigate to="/" replace />} />
        <Route path="/hardware"   element={<Navigate to="/sensors" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

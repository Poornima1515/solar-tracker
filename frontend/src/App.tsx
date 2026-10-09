import { Routes, Route } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import DemoModeBanner from './components/common/DemoModeBanner'
import { useTelemetry } from './hooks/useTelemetry'

import Dashboard from './pages/Dashboard'
import LiveMonitoring from './pages/LiveMonitoring'
import PanelControl from './pages/PanelControl'
import MLModel from './pages/MLModel'
import Comparison from './pages/Comparison'
import CostAnalysis from './pages/CostAnalysis'
import SystemOverview from './pages/SystemOverview'
import HardwareStatus from './pages/HardwareStatus'
import AlgorithmsGuide from './pages/AlgorithmsGuide'

export default function App() {
  const { deviceStatus } = useTelemetry(15000)
  const isDemo = deviceStatus?.demo_mode ?? true

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <DemoModeBanner isDemo={isDemo} />
      <Navbar deviceStatus={deviceStatus} />

      <main className="flex-1 p-4 md:p-6 max-w-screen-xl mx-auto w-full">
        <Routes>
          <Route path="/"           element={<Dashboard />} />
          <Route path="/monitoring" element={<LiveMonitoring />} />
          <Route path="/control"    element={<PanelControl />} />
          <Route path="/ml"         element={<MLModel />} />
          <Route path="/comparison" element={<Comparison />} />
          <Route path="/cost"       element={<CostAnalysis />} />
          <Route path="/overview"   element={<SystemOverview />} />
          <Route path="/hardware"   element={<HardwareStatus />} />
          <Route path="/algorithms" element={<AlgorithmsGuide />} />
        </Routes>
      </main>
    </div>
  )
}

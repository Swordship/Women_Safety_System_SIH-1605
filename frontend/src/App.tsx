import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import SafetyMap from './pages/SafetyMap'
import Cameras from './pages/Cameras'
import Alerts from './pages/Alerts'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/safety-map"  element={<SafetyMap />} />
            <Route path="/cameras"     element={<Cameras />} />
            <Route path="/alerts"      element={<Alerts />} />
            <Route path="/settings"    element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

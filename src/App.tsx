import AdminPanel from './features/admin/AdminPanel'
import Console from './features/console/Console'
import './App.css'

function App() {
  if (window.location.pathname === '/admin') {
    return <AdminPanel />
  }

  return <Console />
}

export default App

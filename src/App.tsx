import AdminPanel from './features/admin/AdminPanel'
import Console from './features/console/Console'

function App() {
  if (window.location.pathname === '/admin') {
    return <AdminPanel />
  }

  return <Console />
}

export default App

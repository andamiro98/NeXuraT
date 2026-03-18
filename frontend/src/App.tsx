import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [message, setMessage] = useState('Loading...')

  useEffect(() => {
    fetch('http://localhost:8080/api/hello')
      .then((res) => res.text())
      .then((data) => setMessage(data))
      .catch((err) => setMessage('백엔드 연결 실패: ' + err.message))
  }, [])

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '2rem' }}>
      {message}
    </div>
  )
}

export default App

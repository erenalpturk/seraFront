// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { MantineProvider, createTheme } from '@mantine/core';
// Mantine CSS'i import et (ZORUNLU)
import '@mantine/core/styles.css';

const theme = createTheme({
  /** Buraya özel tema ayarları gelebilir */
  primaryColor: 'cyan',
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>,
)
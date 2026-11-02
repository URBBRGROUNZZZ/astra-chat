import React from 'react';
import ReactDOM from 'react-dom/client';
import './fonts/inter.css';
import './fonts/title.css';
import App from './App';
import { initializeCredentials } from './config';
import './styles.css';

void initializeCredentials().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
});

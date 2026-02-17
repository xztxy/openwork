import { createHashRouter } from 'react-router-dom';
import { App } from './App';
import HomePage from './pages/Home';
import ExecutionPage from './pages/Execution';
import { Navigate } from 'react-router-dom';

export const router = createHashRouter([
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: HomePage },
      { path: 'execution/:id', Component: ExecutionPage },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

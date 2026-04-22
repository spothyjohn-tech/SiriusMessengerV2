import { render, screen } from '@testing-library/react';
import App from './App';

test('renders sign in', () => {
  render(<App />);
  expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/enter your email/i)).toBeInTheDocument();
});

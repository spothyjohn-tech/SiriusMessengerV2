import { render, screen } from '@testing-library/react';
import App from './App';

test('renders sign in', () => {
  render(<App />);
  expect(screen.getByText(/sirius messenger/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
});

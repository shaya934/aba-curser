import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'BrightPath • ABA Care',
  description: 'A clear path to connected care',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

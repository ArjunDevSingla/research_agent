import '../styles/globals.css'

export const metadata = {
  title:       'PaperSwarm — Research Synthesis',
  description: 'Multi-agent research synthesis. Any language.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

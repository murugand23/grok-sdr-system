import './globals.css'

export const metadata = {
  title: 'Grok SDR - AI-Powered Sales Assistant',
  description: 'Intelligent lead qualification and sales automation',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <h1 className="text-xl font-bold text-gray-900">🚀 Grok SDR</h1>
              </div>
              <div className="flex items-center space-x-4">
                <a href="/" className="text-gray-700 hover:text-gray-900">Qualify</a>
                <a href="/leads" className="text-gray-700 hover:text-gray-900">Leads</a>
                <a href="/search" className="text-gray-700 hover:text-gray-900">Search</a>
                <a href="/evaluation" className="text-gray-700 hover:text-gray-900">Evaluation</a>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
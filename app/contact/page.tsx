import Navbar from '@/components/Navbar'
import ContactForm from '@/components/ContactForm'

export default function ContactPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 max-w-md mx-auto px-6 py-16 w-full">
        <h1 className="text-2xl font-bold mb-2">Contact us</h1>
        <p className="text-gray-600 mb-8">Questions, feedback, or just want to say hi? Send us a message.</p>
        <ContactForm />
      </main>
    </div>
  )
}

import Navbar from '@/components/Navbar'
import ContactForm from '@/components/ContactForm'

export default function ContactPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#113856] text-slate-100">
      <Navbar />
      <main className="flex-1 max-w-md mx-auto px-6 py-16 w-full">
        <h1 className="text-2xl font-bold text-slate-100 mb-2">Contact us</h1>
        <p className="text-slate-300 mb-8">Questions, feedback, or just want to say hi? Send us a message.</p>
        <ContactForm />
      </main>
    </div>
  )
}

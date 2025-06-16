import type React from "react"
interface SectionProps {
  id?: string
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}

export default function Section({ id, title, description, children, className = "" }: SectionProps) {
  return (
    <section id={id} className={`py-16 md:py-24 ${className}`}>
      {(title || description) && (
        <div className="text-center mb-16">
          {title && <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{title}</h2>}
          {description && <p className="text-xl text-gray-300 max-w-2xl mx-auto">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

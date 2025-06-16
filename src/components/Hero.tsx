"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Star, Menu, X } from "lucide-react"

export default function Hero() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

    return (
        <div className="bg-gray-800 min-h-screen">
            <div className="bg-gray-200 rounded-3xl mx-4 md:mx-8 pt-8">


                {/* Hero Content */}
                <div className="px-6 md:px-12 py-12 md:py-20">
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h1 className="text-4xl md:text-6xl font-bold text-black leading-tight mb-6">
                                Launch your Telegram Bot Shop
                                <br />
                                in minutes,
                                <br />
                                without <span className="text-orange-500">any</span> <span className="text-pink-500">coding </span>
                                <span className="text-purple-600">skills</span>
                                <span className="text-blue-600">.</span>
                            </h1>

                            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-4 mb-8">
                                <div className="flex items-center space-x-2">
                                    {/*<img src="/placeholder.svg?height=40&width=40" alt="Profile" className="w-10 h-10 rounded-full" /> */}
                                    <Button
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-full mt-4"

                                    >
                                        Book a Free Call →
                                    </Button>

                                </div>
                                {/* <dSZiv className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">REVIEWED ON</span>
                  <div className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-red-500 text-red-500" />
                    ))}
                  </div>
                  <span className="text-sm font-bold">Clutch</span>
                  <span className="text-sm text-gray-600">9 REVIEWS</span>
                </div>  */}
                            </div>
                        </div>

                        <div className="text-left md:text-right">
                            <div className="flex justify-start md:justify-end items-center space-x-2 mb-8">
                                {/*  <div className="flex -space-x-2">
                                    {[...Array(5)].map((_, i) => (
                                        <img
                                            key={i}
                                            src="/placeholder.svg?height=32&width=32"
                                            alt="Avatar"
                                            className="w-8 h-8 rounded-full border-2 border-white"
                                        />
                                    ))} 
                                </div>*/}
                                <div className="text-sm">
                                    <div className="font-medium">Loved by 500+</div>
                                    <div className="text-gray-600">Businesses worldwide</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Client Logos */}
                    {/*  <div className="flex flex-wrap justify-center items-center gap-4 md:gap-8 mt-16 opacity-60">
                        {["Mavis", "Combinator", "Kodezi", "Mavis", "Mavis", "oppa travel", "Medical Student AI"].map((logo, i) => (
                            <div key={i} className="text-gray-500 font-medium text-sm">
                                {logo}
                            </div>
                        ))}
                    </div>*/}

                    {/* Service Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-16">
                        <div className="bg-gradient-to-br from-slate-700 to-slate-800 p-6 rounded-2xl text-white">
                            <div className="text-sm opacity-80 mb-2">Launch in Minutes</div>
                            <h3 className="text-2xl font-bold mb-4">Instant Bot Setup</h3>
                            <div className="bg-slate-600 rounded-lg p-4 h-32 flex items-center justify-center">
                                {/* Replace with icon or screenshot */}
                                <span className="text-sm text-gray-300">⚡️</span>
                            </div>
                            <p className="mt-4 text-sm opacity-80">
                                Get your Telegram shop live with zero coding—just a few clicks and you’re open for business.
                            </p>
                        </div>
                        <div className="bg-gradient-to-br from-teal-600 to-teal-700 p-6 rounded-2xl text-white">
                            <div className="text-sm opacity-80 mb-2">Marketing & Branding</div>
                            <h3 className="text-2xl font-bold mb-4">Easy grow</h3>
                            <div className="bg-teal-500 rounded-lg p-4 h-32 flex items-center justify-center">
                                {/* Replace with icon or screenshot */}
                                <span className="text-sm text-white">🎨</span>
                            </div>
                            <p className="mt-4 text-sm opacity-80">
                                We provide you tools to increase your sales and customer's loyalty.
                            </p>
                        </div>
                        <div className="bg-gradient-to-br from-purple-600 to-purple-700 p-6 rounded-2xl text-white">
                            <div className="text-sm opacity-80 mb-2">Built-in Security</div>
                            <h3 className="text-2xl font-bold mb-4">Secure Checkout</h3>
                            <div className="bg-purple-500 rounded-lg p-4 h-32 flex items-center justify-center">
                                {/* Replace with icon or screenshot */}
                                <span className="text-sm text-white">🔒</span>
                            </div>
                            <p className="mt-4 text-sm opacity-80">
                                PCI-compliant payments, encrypted data, and fraud protection keep you and your customers safe.
                            </p>
                        </div>
                        <div className="bg-gradient-to-br from-orange-500 to-red-500 p-6 rounded-2xl text-white">
                            <div className="text-sm opacity-80 mb-2">Insights & Help</div>
                            <h3 className="text-2xl font-bold mb-4">Analytics & Support</h3>
                            <div className="bg-orange-400 rounded-lg p-4 h-32 flex items-center justify-center">
                                {/* Replace with icon or screenshot */}
                                <span className="text-sm text-white">📊</span>
                            </div>
                            <p className="mt-4 text-sm opacity-80">
                                Track sales in real time and get 24/7 support from our expert team—so you never miss a beat.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    )
}

'use client';

import Link from 'next/link';
import React, { useState, useEffect } from 'react';
import { Transition } from '@headlessui/react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Header: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);

  useEffect(() => {
    const onScroll = () => {
      // You can tweak the threshold (here 20px) as needed
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    // run on mount in case user refreshes mid‐page
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 w-full transition-colors duration-300 ${
        isScrolled ? 'bg-gray-200 shadow-md' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto px-5 md:px-12">
        <nav className="flex items-center justify-between py-4 md:py-6">
          {/* Logo */}
          <Link href="/" className="text-2xl font-bold text-black">
            Trapyfy
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-8">
            <a href="#features" className="text-gray-700 hover:text-black">
              Features
            </a>
            <a href="#pricing" className="text-gray-700 hover:text-black">
              Pricing
            </a>
            <a href="#contact" className="text-gray-700 hover:text-black">
              Contact Us
            </a>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-full">
            <a href="/sign-up">
              Start now →
              </a>
            </Button>
            <Button className="bg-black hover:bg-gray-800 text-white px-6 py-2 rounded-full">
            <a href="/login">
              Login
              </a>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={toggleMenu}
            className="md:hidden p-2 text-black"
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </nav>
      </div>

      {/* Mobile Menu */}
      <Transition
        show={isOpen}
        enter="transition ease-out duration-200 transform"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-150 transform"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <div className="md:hidden bg-white mx-6 rounded-2xl shadow-lg mb-4">
          <div className="flex flex-col space-y-6 p-6">
            <a href="#features" className="text-gray-700 hover:text-black py-2" onClick={toggleMenu}>
              Features
            </a>
            <a href="#pricing" className="text-gray-700 hover:text-black py-2" onClick={toggleMenu}>
              Pricing
            </a>
            <a href="#contact" className="text-gray-700 hover:text-black py-2" onClick={toggleMenu}>
              Contact Us
            </a>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-full mt-4"
              onClick={toggleMenu}
            >
               <a href="/sign-up" className="text-white hover:text-white py-2" onClick={toggleMenu}>
              Start now →
              </a>
            </Button>
            <Button
              className="bg-black hover:bg-gray-800 text-white px-6 rounded-full mt-4"
              onClick={toggleMenu}
            >
                <a href="/login" className="text-white hover:text-white py-2" onClick={toggleMenu}>
              Login
              </a>
            </Button>
          </div>
        </div>
      </Transition>
    </header>
  );
};

export default Header;

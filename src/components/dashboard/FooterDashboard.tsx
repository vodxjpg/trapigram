import Link from 'next/link';
import React from 'react';
import { FaFingerprint } from 'react-icons/fa';

import { siteDetails } from '@/data/siteDetails';
import { footerDetails } from '@/data/footer';
import { getPlatformIconByName } from '@/utils';

const Footer: React.FC = () => {
    return (
        <footer className="bg-background text-foreground py-2">
            <div className="md:text-center text-foreground-accent px-6 flex flex-col justify-center max-w-4xl m-auto">
                <p className="text-sm mt-2 text-gray-500">Copyright &copy; {new Date().getFullYear()} {siteDetails.siteName}. All rights reserved. - Made with &hearts; </p>
            </div>
        </footer>
    );
};

export default Footer;

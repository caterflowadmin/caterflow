// components/ServiceWorkerRegister.tsx
'use client';
import { logger } from '@/lib/logger';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then((registration) => {
                        logger.debug('SW registered: ', registration);
                    })
                    .catch((registrationError) => {
                        logger.debug('SW registration failed: ', registrationError);
                    });
            });
        }
    }, []);

    return null;
}
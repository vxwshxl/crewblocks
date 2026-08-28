'use client';

import React, { useEffect, useState } from 'react';

const flowMessages = [
  "Drawing the blueprint",
  "Connecting the dots",
  "Mapping your workflow",
  "Building agent pipelines",
  "Sketching collaboration paths"
];

const dashboardMessages = [
  "Assembling your crew",
  "Waking up your agents",
  "Agents reporting for duty",
  "Syncing agent memories",
  "Your crew is getting ready",
  "Deploying agents to their stations"
];

interface AnimatedLoaderProps {
  type: 'flow' | 'dashboard';
}

export default function AnimatedLoader({ type }: AnimatedLoaderProps) {
  const messages = type === 'flow' ? flowMessages : dashboardMessages;
  const [messageIndex, setMessageIndex] = useState(0);
  const [dotCount, setDotCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    // If we've reached the end of the messages, show the final text and stop.
    if (messageIndex >= messages.length) {
      setIsFinished(true);
      return;
    }

    // Interval to control the dots: 0 -> 1 -> 2 -> 3 -> next message
    const dotInterval = setInterval(() => {
      setDotCount((prev) => {
        if (prev >= 3) {
          // Time to move to the next message
          setMessageIndex((idx) => idx + 1);
          return 0; // Reset dots for the new message
        }
        return prev + 1;
      });
    }, 400); // speed of dot appearance

    return () => clearInterval(dotInterval);
  }, [messageIndex, messages.length]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-4 z-[99999]" style={{fontFamily: 'Host Grotesk, sans-serif'}}>
      <div className="flex flex-col items-center justify-center gap-6 animate-fade-in-up w-full max-w-md">
        
        {/* Animated Line Loader Component */}
        <div className="w-full h-1 bg-muted/30 rounded-full overflow-hidden relative">
             <div className="absolute top-0 left-0 h-full bg-primary rounded-full animate-loader-line w-1/3"></div>
        </div>

        {/* Text Container */}
        <div className="h-8 flex items-center justify-center">
            {isFinished ? (
               <p className="text-white text-lg font-medium tracking-wide animate-fade-in">
                   All set. Ready to sail Captain!
               </p>
            ) : (
                <p className="text-muted-foreground text-sm font-medium tracking-wide">
                    {messages[messageIndex]}
                    <span className="inline-block w-6 text-left">
                        {'.'.repeat(dotCount)}
                    </span>
                </p>
            )}
        </div>
      </div>
    </div>
  );
}

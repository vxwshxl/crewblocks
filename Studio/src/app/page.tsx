'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import "./landing.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Info, MonitorSmartphone, ChevronDown } from "lucide-react";
import DownloadExtensionBtn from "@/components/DownloadExtensionBtn";
import { createClient } from "@/utils/supabase/client";

export default function Home() {
  const router = useRouter();
  const heroRef = useRef<HTMLDivElement>(null);
  const [showInfoWarning, setShowInfoWarning] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  /** null until the session check resolves, so the nav never flashes the wrong button. */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // Register GSAP plugins
    gsap.registerPlugin(ScrollTrigger);

    // Initialize Lenis for smooth scrolling
    const lenis = new Lenis();
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);

    // Store DOM elements
    const animatedIcons = document.querySelector(".animated-icons") as HTMLElement;
    let iconElements = Array.from(document.querySelectorAll(".animated-icon")) as HTMLElement[];
    const textSegments = document.querySelectorAll(".text-segment");
    let placeholders = Array.from(document.querySelectorAll(".placeholder-icon")) as HTMLElement[];
    const heroHeader = document.querySelector(".hero-header");
    const heroSection = document.querySelector(".hero") as HTMLElement;
    const scrollIndicator = document.querySelector(".scroll-indicator") as HTMLElement;

    // Track duplicates to clean them up properly between hot-reloads/strict mode
    // @ts-ignore
    window.duplicateIcons = window.duplicateIcons || null;
    // @ts-ignore
    window.duplicateIconsData = window.duplicateIconsData || null;

    if (!animatedIcons || iconElements.length === 0 || textSegments.length === 0 || !heroSection) {
      return;
    }

    const textAnimationOrder: { segment: Element; originalIndex: number }[] = [];
    textSegments.forEach((segment, index) => {
      textAnimationOrder.push({ segment, originalIndex: index });
    });

    // Shuffle array
    for (let i = textAnimationOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [textAnimationOrder[i], textAnimationOrder[j]] = [
        textAnimationOrder[j],
        textAnimationOrder[i],
      ];
    }

    const isMobile = window.innerWidth <= 1000;
    if (isMobile) {
      iconElements = iconElements.slice(0, 4);
      placeholders = placeholders.slice(0, 4);
    }
    const headerIconSize = isMobile ? 30 : 60;
    const currentIconSize = iconElements[0].getBoundingClientRect().width;
    const exactScale = headerIconSize / currentIconSize;

    const scrollTrigger = ScrollTrigger.create({
      trigger: heroSection,
      start: "top top",
      end: `+=${window.innerHeight * 3}px`,
      pin: true,
      pinSpacing: true,
      scrub: 0.5,
      onUpdate: (self) => {
        const progress = self.progress;

        textSegments.forEach((segment) => {
          gsap.set(segment, { opacity: 0 });
        });

        if (scrollIndicator) {
          gsap.set(scrollIndicator, {
            opacity: Math.max(0, 1 - progress * 20),
          });
        }

        if (progress <= 0.3) {
          const moveProgress = progress / 0.3;
          const containerMoveY = -window.innerHeight * 0.3 * moveProgress;

          if (progress <= 0.15) {
            const headerProgress = progress / 0.15;
            const headerMoveY = -50 * headerProgress;
            const headerOpacity = 1 - headerProgress;

            gsap.set(heroHeader, {
              transform: `translate(-50%, calc(-50% + ${headerMoveY}px))`,
              opacity: headerOpacity,
            });
          } else {
            gsap.set(heroHeader, {
              transform: `translate(-50%, calc(-50% + -50px))`,
              opacity: 0,
            });
          }

          // @ts-ignore
          if (window.duplicateIcons) {
              // @ts-ignore
            window.duplicateIcons.forEach((duplicate: any) => {
              if (duplicate.parentNode) {
                duplicate.parentNode.removeChild(duplicate);
              }
            });
            // @ts-ignore
            window.duplicateIcons = null;
            // @ts-ignore
            window.duplicateIconsData = null;
          }

          gsap.set(animatedIcons, {
            x: 0,
            y: containerMoveY,
            scale: 1,
            opacity: 1,
          });

          iconElements.forEach((icon, index) => {
            const staggerDelay = index * 0.1;
            const iconStart = staggerDelay;
            const iconEnd = staggerDelay + 0.5;

            const iconProgress = gsap.utils.mapRange(
              iconStart,
              iconEnd,
              0,
              1,
              moveProgress
            );
            const clampedProgress = Math.max(0, Math.min(1, iconProgress));

            const startOffset = -containerMoveY;
            const individualY = startOffset * (1 - clampedProgress);

            gsap.set(icon, {
              x: 0,
              y: individualY,
            });
          });
        } else if (progress <= 0.6) {
          const scaleProgress = (progress - 0.3) / 0.3;

          gsap.set(heroHeader, {
            transform: `translate(-50%, calc(-50% + -50px))`,
            opacity: 0,
          });

          if (scaleProgress >= 0.5) {
            heroSection.style.backgroundColor = "#e3e3db";
          } else {
            heroSection.style.backgroundColor = "#141414";
          }

          // @ts-ignore
          if (window.duplicateIcons) {
              // @ts-ignore
            window.duplicateIcons.forEach((duplicate: any) => {
              if (duplicate.parentNode) {
                duplicate.parentNode.removeChild(duplicate);
              }
            });
            // @ts-ignore
            window.duplicateIcons = null;
            // @ts-ignore
            window.duplicateIconsData = null;
          }

          const targetCenterY = window.innerHeight / 2;
          const targetCenterX = window.innerWidth / 2;
          const containerRect = animatedIcons.getBoundingClientRect();
          const currentCenterX = containerRect.left + containerRect.width / 2;
          const currentCenterY = containerRect.top + containerRect.height / 2;
          const deltaX = (targetCenterX - currentCenterX) * scaleProgress;
          const deltaY = (targetCenterY - currentCenterY) * scaleProgress;
          const baseY = -window.innerHeight * 0.3;
          const currentScale = 1 + (exactScale - 1) * scaleProgress;

          gsap.set(animatedIcons, {
            x: deltaX,
            y: baseY + deltaY,
            scale: currentScale,
            opacity: 1,
            force3D: true,
          });

          iconElements.forEach((icon) => {
            gsap.set(icon, { x: 0, y: 0 });
          });
        } else if (progress <= 0.75) {
          const moveProgress = (progress - 0.6) / 0.15;

          gsap.set(heroHeader, {
            transform: `translate(-50%, calc(-50% + -50px))`,
            opacity: 0,
          });

          heroSection.style.backgroundColor = "#e3e3db";

          const targetCenterY = window.innerHeight / 2;
          const targetCenterX = window.innerWidth / 2;
          const containerRect = animatedIcons.getBoundingClientRect();
          const currentCenterX = containerRect.left + containerRect.width / 2;
          const currentCenterY = containerRect.top + containerRect.height / 2;
          const deltaX = targetCenterX - currentCenterX;
          const deltaY = targetCenterY - currentCenterY;
          const baseY = -window.innerHeight * 0.3;

          gsap.set(animatedIcons, {
            x: deltaX,
            y: baseY + deltaY,
            scale: exactScale,
            opacity: 0,
            force3D: true,
          });

          iconElements.forEach((icon) => {
            gsap.set(icon, { x: 0, y: 0 });
          });

          // @ts-ignore
          if (!window.duplicateIcons) {
              // @ts-ignore
            window.duplicateIcons = [];
            // @ts-ignore
            window.duplicateIconsData = [];

            iconElements.forEach((icon, index) => {
              const duplicate = icon.cloneNode(true) as HTMLElement;
              duplicate.className = "duplicate-icon";
              duplicate.style.position = "fixed";
              duplicate.style.width = headerIconSize + "px";
              duplicate.style.height = headerIconSize + "px";

              document.body.appendChild(duplicate);
              // @ts-ignore
              window.duplicateIcons.push(duplicate);

              if (index < placeholders.length) {
                const iconRect = icon.getBoundingClientRect();
                const startCenterX = iconRect.left + iconRect.width / 2;
                const startCenterY = iconRect.top + iconRect.height / 2;

                const targetRect = placeholders[index].getBoundingClientRect();
                const targetCenterX = targetRect.left + targetRect.width / 2;
                const targetCenterY = targetRect.top + targetRect.height / 2;

                const startLeft = startCenterX - headerIconSize / 2;
                const startTop = startCenterY - headerIconSize / 2;

                duplicate.style.left = startLeft + "px";
                duplicate.style.top = startTop + "px";

                // @ts-ignore
                window.duplicateIconsData.push({
                   moveX: targetCenterX - startCenterX,
                   moveY: targetCenterY - startCenterY,
                });
              } else {
                // @ts-ignore
                window.duplicateIconsData.push(null);
              }
            });
          }

          // @ts-ignore
          if (window.duplicateIcons) {
              // @ts-ignore
            window.duplicateIcons.forEach((duplicate: any, index: number) => {
              if (index < placeholders.length) {
                // @ts-ignore
                const data = window.duplicateIconsData?.[index];
                if (!data) return;

                let currentX = 0;
                let currentY = 0;

                if (moveProgress <= 0.5) {
                  const verticalProgress = moveProgress / 0.5;
                  currentY = data.moveY * verticalProgress;
                } else {
                  const horizontalProgress = (moveProgress - 0.5) / 0.5;
                  currentY = data.moveY;
                  currentX = data.moveX * horizontalProgress;
                }

                duplicate.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
                duplicate.style.opacity = "1";
                duplicate.style.display = "flex";
                duplicate.style.zIndex = "50";
              }
            });
          }
        } else {
          gsap.set(heroHeader, {
            transform: `translate(-50%, calc(-50% + -100px))`,
            opacity: 0,
          });

          heroSection.style.backgroundColor = "#e3e3db";

          gsap.set(animatedIcons, { opacity: 0 });

          // @ts-ignore
          if (window.duplicateIcons) {
              // @ts-ignore
            window.duplicateIcons.forEach((duplicate: any, index: number) => {
              if (index < placeholders.length) {
                // @ts-ignore
                const data = window.duplicateIconsData?.[index];
                if (!data) return;

                duplicate.style.transform = `translate3d(${data.moveX}px, ${data.moveY}px, 0)`;
                duplicate.style.opacity = "1";
                duplicate.style.display = "flex";
                duplicate.style.zIndex = "50";
              }
            });
          }

          textAnimationOrder.forEach((item, randomIndex) => {
            const segmentStart = 0.75 + randomIndex * 0.03;
            const segmentEnd = segmentStart + 0.015;

            const segmentProgress = gsap.utils.mapRange(
              segmentStart,
              segmentEnd,
              0,
              1,
              progress
            );
            const clampedProgress = Math.max(0, Math.min(1, segmentProgress));

            gsap.set(item.segment, {
              opacity: clampedProgress,
            });
          });
        }
      },
    });

    return () => {
      scrollTrigger.kill();
      // @ts-ignore
      if (window.duplicateIcons) {
          // @ts-ignore
        window.duplicateIcons.forEach((duplicate: any) => {
          if (duplicate.parentNode) {
            duplicate.parentNode.removeChild(duplicate);
          }
        });
        // @ts-ignore
        window.duplicateIcons = null;
        // @ts-ignore
        window.duplicateIconsData = null;
      }
      lenis.destroy();
    };
  }, []);

  // Who the nav is for. Signing out in another tab has to be reflected here,
  // so this listens rather than only reading once.
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setSignedIn(Boolean(data.user));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const goToLogin = () => {
    router.push("/login");
  };

  const goToSignup = () => {
    router.push("/signup");
  };

  const goToDashboard = () => {
    router.push("/dashboard");
  };

  return (
    <div className="landing-page w-full overflow-hidden min-h-screen">
      <header className="navbar">
        <div className="nav-left">
          <Image src="/logoCS.png" className="logo" alt="CrewBlocks logo" width={36} height={36} />
          <span className="brand-name font-bold">CrewBlocks</span>
        </div>
        <div className="nav-right">
          <div
            className="desktop-nav"
            /* Hidden rather than unmounted while the session is unknown, so the
               navbar keeps its width and nothing shifts when it resolves. */
            style={{ visibility: signedIn === null ? "hidden" : "visible" }}
          >
            {!signedIn && (
              <div className="login" onClick={goToLogin}>
                <svg
                  className="account-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>Log in</span>
              </div>
            )}
            <button
              className="btn-primary"
              onClick={signedIn ? goToDashboard : goToSignup}
            >
              {signedIn ? "Dashboard" : "Get Started"}
            </button>
          </div>
          <div className="mobile-nav relative">
            <MonitorSmartphone />
            <Info className="cursor-pointer" onClick={() => setShowInfoWarning(prev => !prev)} />
            
            <div className={`absolute top-full right-0 mt-4 p-3 bg-zinc-900 border border-white/10 text-white text-sm rounded-xl shadow-2xl w-52 transition-all duration-500 pointer-events-none ${showInfoWarning ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
              <div className="absolute -top-2 right-[18px] w-4 h-4 bg-zinc-900 border-t border-l border-white/10 transform rotate-45"></div>
              <p className="relative z-10 text-center text-[15px] font-medium leading-tight">
                Open using your desktop to access the dashboard.
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="hero" ref={heroRef} style={{ color: "#e3e3db" }}>
        <div className="hero-header">
          <h1>CrewBlocks</h1>
          <p>Your Personal Autonomous AI Agent Workforce</p>
          <div className="mt-4">
            <DownloadExtensionBtn />
          </div>
        </div>

        <div className="animated-icons">
          <div className="animated-icon icon-1">
            <Image src="/icon_1.png" alt="" width={100} height={100} />
          </div>
          <div className="animated-icon icon-2">
            <Image src="/icon_2.png" alt="" width={100} height={100} />
          </div>
          <div className="animated-icon icon-3">
            <Image src="/icon_3.png" alt="" width={100} height={100} />
          </div>
          <div className="animated-icon icon-4">
            <Image src="/icon_4.png" alt="" width={100} height={100} />
          </div>
          <div className="animated-icon icon-5">
            <Image src="/icon_5.png" alt="" width={100} height={100} />
          </div>
        </div>

        <h1 className="animated-text">
          <div className="placeholder-icon"></div>
          <span className="text-segment">Build your AI crew</span>
          <div className="placeholder-icon"></div>
          <span className="text-segment">without writing code.</span>{" "}
          <span className="text-segment">Deploy smart agents</span>
          <div className="placeholder-icon"></div>
          <span className="text-segment">that work together</span>
          <div className="placeholder-icon"></div>
          <span className="text-segment">to accomplish any task</span>
          <div className="placeholder-icon"></div>
          <span className="text-segment">autonomously for you.</span>
        </h1>

        <div className="scroll-indicator absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-muted-foreground/80 animate-bounce cursor-default pointer-events-none">
          <span className="text-xs font-semibold tracking-widest uppercase mb-1">Scroll Down</span>
          <ChevronDown className="w-5 h-5" />
        </div>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-black/50 font-medium text-segment pointer-events-none">
          &copy; 2026 CrewBlocks. By Team Commit&Run
        </div>
      </section>
    </div>
  );
}

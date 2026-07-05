import React from "react";
import { Creation, Album, UserProfile, Screen } from "../types";
import { ArrowRight, Sparkles, CheckCircle, Image as ImageIcon, Star } from "lucide-react";

interface AlbumsPageProps {
  userProfile: UserProfile;
  creations: Creation[];
  albums: Album[];
  onSelectCreation: (creation: Creation) => void;
  onNavigate: (screen: Screen) => void;
}

export default function AlbumsPage({ userProfile, creations, albums, onSelectCreation, onNavigate }: AlbumsPageProps) {
  const petName = "Buddy"; // Ideally driven by user's avatar, but using a placeholder or we could find it in state
  
  // Sort creations descending
  const sortedCreations = [...creations].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="pt-24 md:pt-8 pb-32 md:pb-12 px-6 md:px-12 max-w-7xl mx-auto min-h-screen">
      
      {/* Hero: Featured Album */}
      <section className="relative h-[500px] rounded-3xl overflow-hidden mb-12 group cursor-pointer shadow-[0_12px_40px_-10px_rgba(68,42,34,0.15)]">
        <div className="absolute inset-0 z-0">
          <img 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
            alt="Parisian Paw-traits" 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBwRR7_3ruLrZgQCWyQQ93hNAeq_Tkh07ccGlq3P6ZmBxTDrk4l5QcraH0zE_muY0VDzv6EfQNOHJRJK7MJ4WxjR0s7qlbYVYsr6euVMZUKgDZjHVTrpyKrr3VwxklCKHOyOKiN38L3CTlOuSUV85Tr0ZjFgFTyj4HWaKQSIQnjaJTjTe_ZoFAEYOvhDB5zyJeVI3ZVoNZay9PYnlt6t5FRrmocW51QV7iBx_XhKlWlL0ej5j43uRpdQ10-Pn_CxPfrY0bHK_JCZv9L"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/30 to-transparent z-10"></div>
        <div className="absolute bottom-0 left-0 p-8 md:p-12 z-20 w-full md:w-2/3">
          <span className="bg-secondary-fixed/50 backdrop-blur-md px-4 py-1.5 rounded-full text-[10px] tracking-wider font-extrabold text-on-secondary-fixed mb-4 inline-block uppercase">FEATURED WORLD TOUR</span>
          <h2 className="font-headline-xl text-4xl md:text-5xl font-extrabold text-white mb-4 drop-shadow-md">Parisian Paw-traits</h2>
          <p className="text-white/90 text-body-md mb-8 max-w-xl text-shadow-sm">Witness {petName}'s latest adventure in the city of lights. Join the world-famous companion as they explore global landmarks with their furry friends in stunning high-fidelity 3D.</p>
          <div className="flex flex-wrap gap-4">
            <button className="bg-white text-primary px-8 py-3 rounded-xl font-bold hover:bg-surface-container transition-colors active:scale-95 shadow-lg">Open Album</button>
            <button className="bg-transparent border-2 border-white/40 backdrop-blur-md text-white px-8 py-3 rounded-xl font-bold hover:bg-white/10 transition-colors active:scale-95">Share Story</button>
          </div>
        </div>
      </section>

      {/* Bento Section: Recent Shoots */}
      <div className="mb-16">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h3 className="font-headline-lg text-3xl font-extrabold text-primary">Your Shoots</h3>
            <p className="text-on-surface-variant font-medium mt-1">Memories captured with friends across the multiverse</p>
          </div>
          <button className="text-primary font-bold flex items-center gap-1.5 hover:underline decoration-2">
            View All <ArrowRight size={16} />
          </button>
        </div>
        
        <div className="grid grid-cols-12 gap-6">
          {/* Large Card: Zen Garden */}
          <div 
            onClick={() => sortedCreations[0] && onSelectCreation(sortedCreations[0])}
            className="col-span-12 md:col-span-8 h-[400px] rounded-3xl overflow-hidden glass-card relative group cursor-pointer"
          >
            <img 
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
              alt="Kyoto Serenity" 
              src={sortedCreations[0]?.image_url || "https://lh3.googleusercontent.com/aida-public/AB6AXuCSN7nncul9H-Kj0G3hut6Qy0l6evUGMEzYQkOjoTDpvcOhx4ibPmwDxsDngBvfp6yr1eCUeSJCmPYRWMsY2eWZp-V65cTRy97wvRK3G6RPZd7tgwhpm2KI12Uc1PVHCLsF1Y-fs9Hc6HwKi7-x1AvQXlLFXbMqyJKYxbUpY01HgOkj7wNYj0USXSTEF3_PL2avLT61Brmcp0yZEHYwKkzgq-nvzdVAKuWMhrCDMEX0U5mZjoQOgk2htaOTYls4VHZGEzEiJy8aJzNW"}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-transparent flex flex-col justify-end p-8">
              <h4 className="font-headline-lg text-3xl font-bold text-white mb-1">Kyoto Serenity</h4>
              <p className="text-white/80 font-medium">Posed with: Hiro (Shiba Inu)</p>
            </div>
          </div>
          
          {/* Small Card: Space Station */}
          <div 
            onClick={() => sortedCreations[1] && onSelectCreation(sortedCreations[1])}
            className="col-span-12 md:col-span-4 h-[400px] rounded-3xl overflow-hidden glass-card relative group cursor-pointer"
          >
            <img 
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
              alt="Orbit One" 
              src={sortedCreations[1]?.image_url || "https://lh3.googleusercontent.com/aida-public/AB6AXuAbVM6tS7OkAOWL_7e2oDlUb25AiVfzLXDAkZTpIbDcp0oOEiQkE8Hr8X4KKeoLE8LHbMNWc2dpIIQ7Ua72nr7AsYZrStEqlZdsR1jZMy_nksP4dfrtfovIJGUNKVkJ06JjhBYdxfKS7b6hO4WWlE5NR43a_mdP4OxHxdNlQ56LdPcHh5_u04n9J1VQhLNGz_HwRaK8TlqLnAsPRbXRZzOoWYU_Dm44ICS55nBuCGW5qUENiTLMJVZhQtwSIsX57yaJ31kyR7Tsplzm"}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-transparent flex flex-col justify-end p-8">
              <h4 className="font-headline-lg text-2xl font-bold text-white mb-1">Orbit One</h4>
              <p className="text-white/80 font-medium">Posed with: Luna (Poodle)</p>
            </div>
          </div>
          
          {/* Stats Card */}
          <div className="col-span-12 md:col-span-4 h-[200px] rounded-3xl glass-card flex flex-col justify-center items-center p-6 text-center border border-primary/10">
            <ImageIcon className="text-primary mb-3" size={40} />
            <h5 className="font-headline-lg text-2xl font-bold text-primary mb-1">{creations.length > 0 ? creations.length : 84} Shots</h5>
            <p className="text-on-surface-variant font-medium text-sm">Across 12 Unique Biomes</p>
          </div>
          
          {/* AI Enhance Ready Card */}
          <div className="col-span-12 md:col-span-8 h-[200px] rounded-3xl glass-card p-8 flex flex-col md:flex-row items-start md:items-center justify-between border border-primary/10 gap-6">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-primary-container rounded-2xl flex items-center justify-center shrink-0 shadow-inner">
                <Sparkles className="text-on-primary-container" size={32} />
              </div>
              <div>
                <h5 className="font-headline-lg text-2xl font-bold text-primary mb-1">AI Enhance Ready</h5>
                <p className="text-on-surface-variant text-body-sm font-medium">Your raw captures from AR mode are ready for rendering.</p>
              </div>
            </div>
            <button className="bg-primary text-on-primary px-8 py-3 rounded-xl font-bold active:scale-95 transition-transform whitespace-nowrap shadow-md hover:bg-primary/90 w-full md:w-auto">Process</button>
          </div>
        </div>
      </div>

      {/* Premium Booking Section */}
      <section className="rounded-[2.5rem] p-8 md:p-12 relative overflow-hidden bg-primary-container shadow-2xl">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] mix-blend-overlay"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
          <div className="md:w-7/12">
            <span className="bg-primary-fixed/30 text-on-primary-fixed px-3 py-1.5 rounded-full text-[10px] tracking-wider font-extrabold mb-6 inline-block uppercase">Exclusive Access</span>
            <h3 className="font-headline-xl text-4xl md:text-5xl font-extrabold text-on-primary-container mb-6 leading-tight">Unlock {petName}'s Masterpieces</h3>
            <p className="text-on-primary-container/80 text-lg mb-8 max-w-xl font-medium leading-relaxed">Get exclusive access to the 'Master Artist' pose pack and ultra-rare landmarks. Book a premium photoshoot session with global pet photographers to create legendary memories.</p>
            
            <ul className="space-y-4 mb-10">
              <li className="flex items-center gap-3 text-on-primary-container font-bold">
                <CheckCircle size={20} className="text-primary-fixed" />
                8K Ultra-HDR Render Export
              </li>
              <li className="flex items-center gap-3 text-on-primary-container font-bold">
                <CheckCircle size={20} className="text-primary-fixed" />
                Exclusive 'The Colosseum' & 'Great Wall' Sets
              </li>
              <li className="flex items-center gap-3 text-on-primary-container font-bold">
                <CheckCircle size={20} className="text-primary-fixed" />
                Custom Interaction Animations
              </li>
            </ul>
            
            <button className="bg-primary-fixed text-on-primary-fixed px-10 py-4 rounded-xl font-extrabold text-lg shadow-xl hover:scale-105 active:scale-95 transition-all inline-block w-full md:w-auto text-center">
              Book Premium Shoot
            </button>
          </div>
          
          <div className="md:w-5/12 aspect-square glass-card rounded-full p-6 relative flex items-center justify-center w-full max-w-[400px]">
            <div className="w-full h-full rounded-full overflow-hidden border-[12px] border-primary-fixed-dim/50 shadow-inner">
              <img 
                className="w-full h-full object-cover" 
                alt="Bubba the Explorer" 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDIPw_dS7Lk9ZnzJytp5OIFSvYe-o3-dmnRDceXgTN8b5eU7dMNngow29JGkVgP55WqV83FwgTDzYmQN5QN-FHWzUnX1Da1nGaxLlYjpCeeWo-IvkxT6_Gvpaky_tH_CXtidU-3Aub5SbhC38mhHjAjYCN27qeXFzuS0sEBRNRvZZMazrGdbPIgzpwS6HLqnWfh1iQilRGEFIy8g5jIvCMeR-xzEDZwwpMIZ0ESk_acTP8-47Vj4pDLlKzuYHTiRHTCUBH1K4Y9JHvX"
              />
            </div>
            
            {/* Floating Badge */}
            <div className="absolute -top-4 -right-2 bg-surface p-4 rounded-2xl shadow-2xl border border-primary/10 flex items-center gap-3 animate-bounce">
              <div className="w-10 h-10 bg-secondary-container rounded-full flex items-center justify-center shrink-0">
                <Star size={20} className="text-secondary fill-secondary" />
              </div>
              <div>
                <p className="text-[10px] tracking-wider text-on-surface-variant font-extrabold leading-tight uppercase">Premium</p>
                <p className="font-bold text-primary">Limited Edition</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      
    </div>
  );
}

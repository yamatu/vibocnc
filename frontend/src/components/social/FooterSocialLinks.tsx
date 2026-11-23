'use client';

import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  XIcon,
} from '@/components/icons/SocialBrandIcons';
import { useSocialLinks } from '@/components/social/SocialLinksProvider';

const socialPlatforms = [
  {
    key: 'x_url',
    name: 'X',
    Icon: XIcon,
    hoverClass: 'hover:border-white hover:bg-white hover:text-gray-900',
  },
  {
    key: 'facebook_url',
    name: 'Facebook',
    Icon: FacebookIcon,
    hoverClass: 'hover:border-blue-600 hover:bg-blue-600 hover:text-white',
  },
  {
    key: 'instagram_url',
    name: 'Instagram',
    Icon: InstagramIcon,
    hoverClass: 'hover:border-pink-600 hover:bg-pink-600 hover:text-white',
  },
  {
    key: 'linkedin_url',
    name: 'LinkedIn',
    Icon: LinkedInIcon,
    hoverClass: 'hover:border-sky-700 hover:bg-sky-700 hover:text-white',
  },
] as const;

export default function FooterSocialLinks() {
  const socialConfig = useSocialLinks();
  const socialLinks = socialConfig?.show_in_footer
    ? socialPlatforms
        .map((platform) => ({ ...platform, href: socialConfig[platform.key].trim() }))
        .filter((platform) => platform.href)
    : [];

  if (socialLinks.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-white">Follow Vibocnc</h3>
      <div className="mt-3 flex min-h-10 items-center gap-2">
        {socialLinks.map(({ name, href, Icon, hoverClass }) => (
          <a
            key={name}
            href={href}
            target="_blank"
            rel="me noopener noreferrer"
            aria-label={`Follow Vibocnc on ${name}`}
            title={name}
            className={`flex h-10 w-10 items-center justify-center rounded-md border border-gray-700 text-gray-300 transition-colors ${hoverClass}`}
          >
            <Icon className="h-5 w-5" />
          </a>
        ))}
      </div>
    </div>
  );
}

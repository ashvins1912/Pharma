import tabletStripImg from '../assets/images/pharma_tablet_strip_1794464182800.jpg';
import syrupBottleImg from '../assets/images/pharma_syrup_bottle_1794464182125.jpg';
import capsuleBottleImg from '../assets/images/pharma_capsule_bottle_1794464183096.jpg';
import wellnessSupplementImg from '../assets/images/pharma_wellness_supplement_1794464182992.jpg';

export const PHARMA_PLACEHOLDER_IMAGES = {
    tablet: tabletStripImg,
    capsule: capsuleBottleImg,
    syrup: syrupBottleImg,
    wellness: wellnessSupplementImg,
    default: tabletStripImg
};

/**
 * Get high-quality professional placeholder image based on medicine dosage form or category
 */
export function getPharmaPlaceholderImage(dosageForm = '', category = '') {
    const form = String(dosageForm || '').toLowerCase();
    const cat = String(category || '').toLowerCase();

    if (form.includes('syrup') || form.includes('drop') || form.includes('liquid')) {
        return syrupBottleImg;
    }
    if (form.includes('capsule') || cat.includes('antibiotic')) {
        return capsuleBottleImg;
    }
    if (cat.includes('vitamin') || cat.includes('supplement') || cat.includes('wellness')) {
        return wellnessSupplementImg;
    }
    return tabletStripImg;
}

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile,
  sendEmailVerification,
  reload,
  signOut, 
  onAuthStateChanged,
  User 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  serverTimestamp 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  subscriptionStatus: 'active' | 'free_trial' | 'canceled' | 'past_due' | 'unsubscribed';
  subscriptionPlan?: 'basic' | 'pro' | 'corp';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  interviewsCount: number;
  interviewsLimit: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface InterviewRecord {
  id?: string;
  userId: string;
  role: string;
  candidateName?: string;
  candidateEmail?: string;
  isCandidateInvite?: boolean;
  report: string;
  score: number;
  redFlags: number;
  summary: string;
  createdAt: any;
}

// Get or initialize user profile document in Firestore
export async function syncUserProfile(user: User): Promise<UserProfile> {
  const isRodrigoDev = user.email?.toLowerCase() === 'rodrigoalto25@gmail.com';

  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data() as UserProfile;
      
      // Auto-grant Corporate Plan to developer/tester account
      if (isRodrigoDev && (data.subscriptionPlan !== 'corp' || data.subscriptionStatus !== 'active')) {
        data.subscriptionStatus = 'active';
        data.subscriptionPlan = 'corp';
        data.interviewsLimit = 100;
        try {
          await updateDoc(userRef, {
            subscriptionStatus: 'active',
            subscriptionPlan: 'corp',
            interviewsLimit: 100,
            updatedAt: serverTimestamp(),
          });
        } catch (updateErr) {
          console.warn("Could not update Firestore profile with corp plan:", updateErr);
        }
      }

      if (data.interviewsLimit === undefined) {
        data.interviewsLimit = data.subscriptionStatus === 'active' 
          ? (data.subscriptionPlan === 'basic' ? 5 : data.subscriptionPlan === 'corp' ? 100 : 20)
          : 2;
      }
      if (data.interviewsCount === undefined) {
        data.interviewsCount = 0;
      }
      return data;
    }

    const newProfile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Usuario',
      photoURL: user.photoURL || '',
      subscriptionStatus: isRodrigoDev ? 'active' : 'free_trial',
      subscriptionPlan: isRodrigoDev ? 'corp' : undefined,
      interviewsCount: 0,
      interviewsLimit: isRodrigoDev ? 100 : 2, // 100 for Corp / 2 for free trial
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(userRef, newProfile);
    return newProfile;
  } catch (err) {
    console.warn("Firestore sync error, returning local user profile fallback:", err);
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Usuario',
      photoURL: user.photoURL || '',
      subscriptionStatus: isRodrigoDev ? 'active' : 'free_trial',
      subscriptionPlan: isRodrigoDev ? 'corp' : undefined,
      interviewsCount: 0,
      interviewsLimit: isRodrigoDev ? 100 : 2,
    };
  }
}

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  reload,
  signOut,
  onAuthStateChanged
};
export type { User };

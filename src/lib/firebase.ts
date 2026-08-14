import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile,
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
  report: string;
  score: number;
  redFlags: number;
  summary: string;
  createdAt: any;
}

// Get or initialize user profile document in Firestore
export async function syncUserProfile(user: User): Promise<UserProfile> {
  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data() as UserProfile;
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
      subscriptionStatus: 'free_trial',
      interviewsCount: 0,
      interviewsLimit: 2, // 2 free trial interviews
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
      subscriptionStatus: 'free_trial',
      interviewsCount: 0,
      interviewsLimit: 2,
    };
  }
}

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged
};
export type { User };

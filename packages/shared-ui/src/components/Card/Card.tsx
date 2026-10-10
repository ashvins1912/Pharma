import React from 'react';
import styles from './Card.module.css';

interface CardProps {
  title: string;
  description: string;
  buttonText?: string;
  onAction?: () => void;
}

export const Card: React.FC<CardProps> = ({ title, description, buttonText, onAction }) => (
  <article className={styles.card}>
    <div className={styles.contentGroup}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.description}>{description}</p>
    </div>
    {buttonText && (
      <button className={styles.actionBtn} onClick={onAction} type="button">
        {buttonText}
      </button>
    )}
  </article>
);

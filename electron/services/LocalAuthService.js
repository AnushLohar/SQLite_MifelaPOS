// electron/services/LocalAuthService.js
import bcrypt from 'bcryptjs';
import { getKnex } from '../database/knex.js';
import crypto from 'crypto';

export default class LocalAuthService {
    static async login(username, password) {
        const db = getKnex(); // Retrieve the initialized database instance

        const user = await db('local_users').where({ username, is_active: true }).first();
        if (!user) throw new Error('User not found or inactive');

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) throw new Error('Invalid credentials');

        // Generate secure local session token
        const sessionToken = crypto.randomBytes(32).toString('hex');

        return {
            token: sessionToken,
            user: { id: user.id, username: user.username, role: user.role }
        };
    }
}